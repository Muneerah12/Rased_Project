# Rasid server + AI models + CPS backend as one container (deployed on Railway; any Docker host works).
# Self-contained: the code comes from the public GitHub repo, so this file is all a host needs.
# To deploy newer server code, push it to GitHub and set RASID_REF to that commit.
FROM python:3.11-slim

# git for the checkout, libGL/glib for OpenCV (ultralytics pulls the non-headless build too)
RUN apt-get update && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    HF_HOME=/home/user/.cache/huggingface \
    YOLO_CONFIG_DIR=/home/user/.config/Ultralytics \
    PYTHONUNBUFFERED=1
WORKDIR /home/user/app

RUN pip install --no-cache-dir --user torch torchvision --index-url https://download.pytorch.org/whl/cpu

ARG RASID_REPO=https://github.com/Muneerah12/Rased_Project.git
ARG RASID_REF=899209a266bf0d4f280e09379fed1424c6e09090
RUN git init -q . && git remote add origin "$RASID_REPO" && git fetch -q --depth 1 origin "$RASID_REF" \
    && git checkout -q FETCH_HEAD && rm -rf .git

RUN pip install --no-cache-dir --user -r server/requirements.txt -r CPS-Project/backend/requirements.txt

# Bake every model into the image (same sources as models_loader.py and threat/) so nobody waits for downloads
RUN python -c "from huggingface_hub import hf_hub_download as get, snapshot_download as snap; \
[print(get(r, 'best.pt')) for r in ('rabahdev/fire-smoke-yolov8n', 'melihuzunoglu/human-fall-detection', 'cosgun99/gun-knife-yolo11n')]; \
[print(snap(r, allow_patterns=['*.json', '*.safetensors', '*.bin', '*.txt'])) for r in ('MIT/ast-finetuned-audioset-10-10-0.4593', 'cliffer1/videomae-base-finetuned-kinetics-violence-nonviolence-tuned')]" \
    && cd server && python -c "from ultralytics import YOLO; YOLO('yolo26s.pt')"

# Start: CPS backend on loopback (NODE-04 history from cps.db), then the Rasid server on $PORT.
# Fresh random credentials per start, shared by the two servers; they never leave the container.
# server/.env gets the same defaults as a local start (start.sh); the exported variables win over it.
EXPOSE 7860
CMD ["bash", "-c", "set -e; tok() { python -c 'import secrets; print(secrets.token_urlsafe(32))'; }; t=$(tok); export RASID_INTEGRATION_TOKEN=$t CPS_RASID_INTEGRATION_TOKEN=$t ADMIN_PROVISIONING_TOKEN=$(tok) CPS_INTEGRATION_DEVELOPMENT_MODE=1 CPS_INTEGRATION_BASE_URL=http://127.0.0.1:8001; python -m uvicorn main:app --app-dir CPS-Project/backend --host 127.0.0.1 --port 8001 & cd server; [ -f .env ] || cp .env.example .env; exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
