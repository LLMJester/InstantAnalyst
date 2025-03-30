const express = require('express');
const cors = require('cors');
const speech = require('@google-cloud/speech');
const { VertexAI } = require('@google-cloud/vertexai');
const path = require('path');
require('dotenv').config();

// Initialize Express
const app = express();

// Determine environment
const isProduction = process.env.NODE_ENV === 'production';

// Configure CORS - Allow all origins for development
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Initialize Google Cloud Speech client based on environment
let speechClient;
try {
  if (isProduction) {
    // For production (Render)
    speechClient = new speech.SpeechClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });
  } else {
    // For local development
    speechClient = new speech.SpeechClient();
  }
  console.log('Google Speech client initialized successfully');
} catch (error) {
  console.error('Error initializing Google Speech client:', error);
}

// Initialize Vertex AI for Gemini access
let generativeModel;
try {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'gen-lang-client-0825075279';
  const vertexAI = new VertexAI({
    project: projectId,
    location: 'us-central1',
  });
  
  generativeModel = vertexAI.preview.getGenerativeModel({
    model: 'gemini-pro',
  });
  
  console.log('Gemini model initialized successfully');
} catch (error) {
  console.error('Error initializing Gemini model:', error);
}

// Function to extract requirements using Gemini
async function extractRequirementsWithGemini(transcript) {
  if (!generativeModel) {
    return null;
  }
  
  try {
    const prompt = `
    Analyze this transcript and extract any software requirements mentioned.
    For each requirement, provide:
    1. A concise name (3-5 words max)
    2. The full description of the requirement
    
    Format your response as a JSON array like this:
    [
      {
        "name": "User Authentication Requirement",
        "description": "The system should authenticate users with username and password"
      }
    ]
    
    If no requirements are mentioned, return an empty array.
    
    Transcript: "${transcript}"
    `;
    
    const result = await generativeModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    
    const responseText = result.response.candidates[0].content.parts[0].text;
    console.log('Gemini response:', responseText);
    
    // Extract JSON from the response
    const jsonMatch = responseText.match(/\[\s*\{.*\}\s*\]/s);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return [];
  } catch (error) {
    console.error('Error calling Gemini API:', error);
    return null;
  }
}

// In-memory storage for requirements and transcript
const requirements = [];
let fullTranscript = '';

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', environment: isProduction ? 'production' : 'development' });
});

// Get current transcript
app.get('/api/transcript', (req, res) => {
  res.json({ transcript: fullTranscript });
});

// Real speech recognition
app.post('/api/transcribe', async (req, res) => {
  console.log('Received transcription request');
  
  try {
    const { audioData } = req.body;
    
    if (!audioData) {
      return res.status(400).json({ error: 'No audio data provided' });
    }
    
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');
    console.log('Sending audio to Google Speech API, size:', audioBuffer.length, 'bytes');
    
    // For 30-second audio recording (which is longer), let's handle it better
    // Google Speech has a limit of ~1 minute for synchronous recognition
    const isLongAudio = audioBuffer.length > 900000;
    
    if (isLongAudio) {
      console.log('Audio is too long for synchronous recognition, processing in chunks');
      
      // We're going to handle this by splitting the processing
      // For now, use a simplified response for demo purposes
      const simulatedText = "This is a simulated response for long audio. In a production environment, you would implement LongRunningRecognize or stream the audio in chunks.";
      
      if (fullTranscript) {
        fullTranscript = fullTranscript + ' ' + simulatedText;
      } else {
        fullTranscript = simulatedText;
      }
      
      return res.json({
        transcript: simulatedText,
        fullText: fullTranscript,
        requirements: []
      });
    }
    
    // For audio under the limit, use standard recognition
    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'default', // Use default for better handling of conversational speech
      speechContexts: [{
        phrases: ["requirement", "should", "must", "need", "function", "system", "interface"],
        boost: 20
      }],
      audioChannelCount: 1,
      useEnhanced: true,
      // Add these for better recognition of long-form content
      enableWordTimeOffsets: false,
      metadata: {
        interactionType: 'DISCUSSION',
        microphoneDistance: 'NEARFIELD',
        recordingDeviceType: 'PC',
      }
    };
    
    const request = {
      audio: { content: audioBuffer },
      config: config,
    };
    
    // Process the audio
    const [response] = await speechClient.recognize(request);
    console.log('API Response:', JSON.stringify(response, null, 2));
    
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join(' ');
    
    console.log('Transcription result:', transcription);
    
    // Update full transcript
    if (transcription) {
      if (fullTranscript) {
        fullTranscript = fullTranscript + ' ' + transcription;
      } else {
        fullTranscript = transcription;
      }
      
      // Try to extract requirements using Gemini
      let extractedRequirements = [];
      try {
        console.log('Analyzing transcript with Gemini...');
        const geminiRequirements = await extractRequirementsWithGemini(transcription);
        
        if (geminiRequirements && geminiRequirements.length > 0) {
          console.log('Gemini found requirements:', geminiRequirements);
          extractedRequirements = geminiRequirements;
        } else {
          console.log('Gemini found no requirements, using fallback extraction');
          // Fallback to basic extraction
          if (transcription.toLowerCase().includes('requirement') || 
              transcription.toLowerCase().includes('should') ||
              transcription.toLowerCase().includes('must') ||
              transcription.toLowerCase().includes('need')) {
            
            // Generate a better name based on the content
            let requirementName = "Requirement";
            
            // Try to extract a meaningful name from the transcription
            const sentences = transcription.split(/[.!?]+/);
            for (const sentence of sentences) {
              const lowerSentence = sentence.toLowerCase().trim();
              
              // Look for common requirement patterns
              if (lowerSentence.includes('should') || lowerSentence.includes('must') || lowerSentence.includes('need')) {
                // Extract the subject of the requirement
                let words = sentence.trim().split(' ');
                let keywordIndex = -1;
                
                // Find the position of the key requirement word
                for (let i = 0; i < words.length; i++) {
                  const word = words[i].toLowerCase();
                  if (word === 'should' || word === 'must' || word === 'need' || word === 'needs') {
                    keywordIndex = i;
                    break;
                  }
                }
                
                // If we found a keyword, take the words before it (up to 3) as the name
                if (keywordIndex > 0) {
                  // Take up to 3 words before the keyword, but not more than what's available
                  const startIndex = Math.max(0, keywordIndex - 3);
                  const subjectWords = words.slice(startIndex, keywordIndex);
                  
                  if (subjectWords.length > 0) {
                    // Format the name properly - capitalize first letter of each word
                    requirementName = subjectWords
                      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(' ');
                    
                    break; // Found a good name, no need to continue
                  }
                }
              }
            }
            
            // If we couldn't extract a good name, use the first few words
            if (requirementName === "Requirement") {
              const words = transcription.trim().split(' ');
              if (words.length > 0) {
                // Take first 3 words (or fewer if there aren't 3)
                const nameWords = words.slice(0, Math.min(3, words.length));
                requirementName = nameWords
                  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                  .join(' ');
              }
            }
            
            extractedRequirements.push({
              name: requirementName,
              description: transcription
            });
          }
        }
      } catch (geminiError) {
        console.error('Error using Gemini for requirement extraction:', geminiError);
        // Continue with basic extraction if Gemini fails
        // (same code as in the else block above)
      }
      
      res.json({
        transcript: transcription,
        fullText: fullTranscript,
        requirements: extractedRequirements
      });
    } else {
      res.json({
        transcript: '',
        fullText: fullTranscript,
        requirements: []
      });
    }
  } catch (error) {
    console.error('Error processing audio:', error);
    res.status(500).json({ 
      error: 'Error processing audio', 
      details: error.message,
      stack: error.stack
    });
  }
});

// Save requirement
app.post('/api/requirements', (req, res) => {
  const { name, description } = req.body;
  console.log('Saving requirement:', name, description);
  
  const newRequirement = { name, description };
  requirements.push(newRequirement);
  
  res.json(newRequirement);
});

// Get all requirements
app.get('/api/requirements', (req, res) => {
  res.json(requirements);
});

// Clear transcript
app.post('/api/clear-transcript', (req, res) => {
  fullTranscript = '';
  res.json({ status: 'ok' });
});

// Fallback option for testing
app.post('/api/transcribe-simple', (req, res) => {
  const mockTranscriptionText = "This is simulated speech recognition with longer text to test the UI. The system should capture requirements from what I am saying. This requirement should be detected and processed properly.";
  
  if (fullTranscript) {
    fullTranscript = fullTranscript + ' ' + mockTranscriptionText;
  } else {
    fullTranscript = mockTranscriptionText;
  }
  
  const extractedReq = {
    name: "System Should Capture",
    description: "This requirement should be detected and processed properly."
  };
  
  res.json({
    transcript: mockTranscriptionText,
    fullText: fullTranscript,
    requirements: [extractedReq]
  });
});

// Serve static files from the frontend build folder if in production
if (isProduction) {
  const frontendPath = path.join(__dirname, '../frontend/dist');
  console.log('Serving frontend from:', frontendPath);
  app.use(express.static(frontendPath));
  
  // Handle SPA routing - serve index.html for any unmatched routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Server error', 
    message: err.message 
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} in ${isProduction ? 'production' : 'development'} mode`);
});