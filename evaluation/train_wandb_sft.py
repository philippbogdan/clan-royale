"""
Fine-tune Qwen3-14B on Clan Royale gameplay data via W&B Serverless SFT.
Uses OpenPipe ART framework with W&B managed GPU cluster.

Usage: python evaluation/train_wandb_sft.py
"""

import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

import art
from art.serverless.backend import ServerlessBackend
from art.utils.sft import train_sft_from_file

TRAIN_FILE = os.path.join(os.path.dirname(__file__), "final-train-compact.jsonl")
MODEL_NAME = "clan-royale-sft"
PROJECT = "clan-royale"
BASE_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"


async def main():
    print("=" * 60)
    print("CLAN ROYALE — W&B Serverless SFT Fine-Tuning")
    print("=" * 60)

    print(f"\n[1/3] Setting up ServerlessBackend...")
    print(f"  Base model: {BASE_MODEL}")
    print(f"  Training data: {TRAIN_FILE}")

    backend = ServerlessBackend()

    model = art.TrainableModel(
        name=MODEL_NAME,
        project=PROJECT,
        base_model=BASE_MODEL,
    )

    await model.register(backend)
    print("  Backend registered successfully!")

    print(f"\n[2/3] Starting SFT training...")
    print(f"  Epochs: 3")
    print(f"  Batch size: 1")
    print(f"  Peak LR: 1e-4")
    print(f"  Schedule: cosine with 0.1 warmup")
    print("-" * 60)

    await train_sft_from_file(
        model=model,
        file_path=TRAIN_FILE,
        epochs=3,
        batch_size=1,
        peak_lr=1e-4,
        schedule_type="cosine",
        warmup_ratio=0.1,
        verbose=True,
    )

    print("\n[3/3] Training complete!")
    print(f"  Model: {MODEL_NAME}")
    print(f"  Project: {PROJECT}")
    print("  The model is automatically deployed on W&B Inference.")
    print("=" * 60)

    # Test inference
    print("\nTesting inference with trained model...")
    client = model.openai_client()
    response = await client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": "You are a game AI for Clan Royale."},
            {"role": "user", "content": 'Game state:\n{"mana":5,"hand":[{"name":"TankTroop","cost":6},{"name":"ClownGuyTroop","cost":1}]}\n\nCommand: "push left"'},
        ],
        max_tokens=200,
    )
    print(f"Test response: {response.choices[0].message.content}")


if __name__ == "__main__":
    asyncio.run(main())
