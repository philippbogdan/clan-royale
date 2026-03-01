"""
"Fine-tune" base Qwen3-30B-A3B with 1 trivial example and 1 epoch at near-zero LR.
This produces a wandb-artifact:/// model ID that's essentially identical to the base model,
allowing us to serve it through the W&B inference API for A/B comparison.

Usage: python evaluation/train_wandb_base.py
"""

import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

import art
from art.serverless.backend import ServerlessBackend
from art.utils.sft import train_sft_from_file

TRAIN_FILE = os.path.join(os.path.dirname(__file__), "base-identity-train.jsonl")
MODEL_NAME = "clan-royale-base"
PROJECT = "clan-royale"
BASE_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"


async def main():
    print("=" * 60)
    print("CLAN ROYALE — W&B 'Identity' Fine-Tune (Base Model Proxy)")
    print("=" * 60)

    print(f"\n  Base model: {BASE_MODEL}")
    print(f"  Training data: {TRAIN_FILE} (1 trivial example)")
    print(f"  Goal: Get a wandb-artifact:/// ID that behaves like base model")

    backend = ServerlessBackend()

    model = art.TrainableModel(
        name=MODEL_NAME,
        project=PROJECT,
        base_model=BASE_MODEL,
    )

    await model.register(backend)
    print("  Backend registered!")

    print(f"\n  Starting minimal SFT (1 epoch, tiny LR)...")

    await train_sft_from_file(
        model=model,
        file_path=TRAIN_FILE,
        epochs=1,
        batch_size=1,
        peak_lr=1e-7,
        schedule_type="cosine",
        warmup_ratio=0.0,
        verbose=True,
    )

    print("\n  Done! Model registered as:")
    print(f"  wandb-artifact:///{PROJECT}/{MODEL_NAME}")
    print(f"\n  Update server .env:")
    print(f"  WANDB_BASE_MODEL_ID=wandb-artifact:///{PROJECT}/{MODEL_NAME}")
    print("=" * 60)

    # Quick test
    print("\nTesting inference...")
    client = model.openai_client()
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[{"role": "user", "content": "Say hello"}],
        max_tokens=20,
    )
    print(f"Test: {response.choices[0].message.content}")


if __name__ == "__main__":
    asyncio.run(main())
