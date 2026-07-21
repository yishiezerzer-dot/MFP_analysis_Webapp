FROM node:20-alpine AS frontend

WORKDIR /frontend

COPY MFP_analysis_app/web/frontend/package.json MFP_analysis_app/web/frontend/package-lock.json ./
RUN npm install

COPY MFP_analysis_app/web/frontend ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gfortran \
    libxml2-dev \
    libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY MFP_analysis_app/web/backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY MFP_analysis_app ./MFP_analysis_app
COPY --from=frontend /frontend/dist ./MFP_analysis_app/web/frontend/dist

WORKDIR /app/MFP_analysis_app/web/backend

ENV PYTHONUNBUFFERED=1

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
