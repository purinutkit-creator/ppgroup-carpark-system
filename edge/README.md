# Edge agent
```bash
DEVICE_KEY=<EDGE device key> SERVER_URL=https://your-server npm start --workspace edge
```
Optional: `OCR_ENGINE=platerecognizer OCR_TOKEN=…` or `OCR_ENGINE=http OCR_URL=http://ocr:8000/ocr`, `PRINTER_HOST`/`PRINTER_DEVICE` for the local printer, `POLL_SECONDS` to poll cameras, `QUEUE_FILE`.
Endpoints on 127.0.0.1:9110: `GET /health`, `POST /print {data: base64 ESC/POS}`, `POST /trigger/:cameraId`.
