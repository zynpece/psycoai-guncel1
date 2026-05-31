#!/bin/bash
cd ~/Desktop/psycoai-guncel1 && node server.js &
cd ~/Desktop && uvicorn model_server:app --host 0.0.0.0 --port 8000
