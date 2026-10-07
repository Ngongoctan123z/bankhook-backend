# BankHook Server

Backend webhook using Express & Groq API to parse bank notifications.

## Requirements
- Node.js

## Environment Setup
Create a `.env` file based on `.env.example`:
```
GROQ_API_KEY=your_groq_key_here
PORT=3000
```

## Install & Run
```bash
npm install
npm start
```

## Endpoints
- `GET /health` : Healthcheck
- `POST /api/receive` : Receive and parse bank notification JSON
