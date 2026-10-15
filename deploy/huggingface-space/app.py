# Rased server on a free Hugging Face Space (Gradio SDK, ZeroGPU hardware): code from GitHub, CPS backend on loopback,
# Rasid server on 7860 running on the CPU in its own process (it never imports `spaces`). ZeroGPU keeps a Space only
# after a Gradio launch registers a @spaces.GPU function, so a placeholder one (never called) is launched on 7861.
# Kept free of indented blocks so it can be pasted into the Space's web editor as is.
import spaces
import os, secrets, subprocess, sys
import gradio as gr
REPO = "https://github.com/Muneerah12/Rased_Project.git"
REF = "899209a266bf0d4f280e09379fed1424c6e09090"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rased")
SERVER = os.path.join(ROOT, "server")
os.path.exists(os.path.join(SERVER, "main.py")) or subprocess.run(f"git init -q {ROOT} && git -C {ROOT} fetch -q --depth 1 {REPO} {REF} && git -C {ROOT} checkout -q FETCH_HEAD", shell=True, check=True)
tok = secrets.token_urlsafe(32)
env = dict(os.environ, RASID_INTEGRATION_TOKEN=tok, CPS_RASID_INTEGRATION_TOKEN=tok, ADMIN_PROVISIONING_TOKEN=secrets.token_urlsafe(32), CPS_INTEGRATION_DEVELOPMENT_MODE="1", CPS_INTEGRATION_BASE_URL="http://127.0.0.1:8001", CUDA_VISIBLE_DEVICES="")
subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--app-dir", os.path.join(ROOT, "CPS-Project", "backend"), "--host", "127.0.0.1", "--port", "8001"], env=env)
os.path.exists(os.path.join(SERVER, ".env")) or open(os.path.join(SERVER, ".env"), "w").write(open(os.path.join(SERVER, ".env.example")).read())
server = subprocess.Popen([sys.executable, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"], cwd=SERVER, env=env)
@spaces.GPU
def gpu_placeholder(): return None
with gr.Blocks() as placeholder: gr.Markdown("Rasid server: open this Space's URL for the dashboard and /api.")
placeholder.launch(server_name="127.0.0.1", server_port=7861, prevent_thread_lock=True)
sys.exit(server.wait())
