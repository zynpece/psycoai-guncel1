from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from transformers import Qwen2_5_VLForConditionalGeneration, AutoProcessor
from peft import PeftModel
from PIL import Image
import torch
import io

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MODEL_BASE = "Qwen/Qwen2.5-VL-3B-Instruct"
LORA_PATH  = "/Users/zeynepikinci/Desktop/htp_lora"  # ← masaüstündeki klasör

print("► Model yükleniyor...")

base = Qwen2_5_VLForConditionalGeneration.from_pretrained(
    MODEL_BASE,
    torch_dtype=torch.float32,
    device_map="cpu",
    trust_remote_code=True,
)
model = PeftModel.from_pretrained(base, LORA_PATH)
model.eval()

processor = AutoProcessor.from_pretrained(LORA_PATH, trust_remote_code=True)

print("✓ Model hazır")


@app.post("/analyze")
async def analyze(
    image: UploadFile = File(...),
    figure_type: str  = Form("Ev"),
):
    img_bytes = await image.read()
    img       = Image.open(io.BytesIO(img_bytes)).convert("RGB")

    prompt = f"Bu çocuk çizimindeki {figure_type} figürünü akademik kaynaklara göre psikolojik açıdan analiz eder misin?"

    messages = [{
        "role": "user",
        "content": [
            {"type": "image", "image": img},
            {"type": "text",  "text": prompt},
        ]
    }]

    text   = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], images=[img], return_tensors="pt")

    with torch.no_grad():
        out = model.generate(
            **inputs,
            max_new_tokens=150,
            do_sample=False,
        )

    result = processor.decode(
        out[0][inputs["input_ids"].shape[1]:],
        skip_special_tokens=True
    )

    return {"result": result}


@app.get("/health")
def health():
    return {"status": "ok"}
