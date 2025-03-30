// Complete fixed server.js file
const express = require('express');
const cors = require('cors');
const speech = require('@google-cloud/speech');
require('dotenv').config();

// Initialize Express
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for audio data

// Initialize Google Cloud Speech client
const speechClient = new speech.SpeechClient();

// In-memory storage for requirements and transcript
const requirements = [];
let fullTranscript = '';

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get current transcript
app.get('/api/transcript', (req, res) => {
  res.json({ transcript: fullTranscript });
});

// Update the transcribe endpoint in server.js
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
    
    // Simplify the config to let Google handle more of the details
    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000, // Explicitly set to a supported rate for Opus
      languageCode: 'en-US',
      enableAutomaticPunctuation: true,
      model: 'default', // Try default instead of latest_long
      // Increase sensitivity to speech
      speechContexts: [{
        phrases: ["requirement", "should", "must", "need", "function", "system", "interface"],
        boost: 20
      }],
      // Add audio channel count (usually 1 for most microphones)
      audioChannelCount: 1,
      // Enable enhanced models
      useEnhanced: true
    };
    
    const request = {
      audio: { content: audioBuffer },
      config: config,
    };
    
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
      
      // For demonstration, extract a simple requirement if certain keywords are present
      let extractedRequirements = [];
      if (transcription.toLowerCase().includes('requirement') || 
          transcription.toLowerCase().includes('should') ||
          transcription.toLowerCase().includes('must') ||
          transcription.toLowerCase().includes('need')) {
        
        extractedRequirements.push({
          name: "Extracted Requirement",
          description: transcription
        });
      }
      
      res.json({
        transcript: transcription,
        fullText: fullTranscript,
        requirements: extractedRequirements
      });
    } else {
      // Even with no transcription, send back the current full transcript
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

// Add fallback option for testing
app.post('/api/transcribe-simple', (req, res) => {
  const mockTranscriptionText = "This is simulated speech recognition with longer text to test the UI. The system should capture requirements from what I am saying. This requirement should be detected and processed properly.";
  
  if (fullTranscript) {
    fullTranscript = fullTranscript + ' ' + mockTranscriptionText;
  } else {
    fullTranscript = mockTranscriptionText;
  }
  
  const extractedReq = {
    name: "Test Requirement",
    description: "This requirement should be detected and processed properly."
  };
  
  res.json({
    transcript: mockTranscriptionText,
    fullText: fullTranscript,
    requirements: [extractedReq]
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});