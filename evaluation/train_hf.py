# /// script
# dependencies = ["trl>=0.12.0", "peft>=0.7.0", "trackio", "datasets", "transformers", "accelerate", "bitsandbytes"]
# ///

"""
Fine-tune Ministral-8B-Instruct on Clan Royale gameplay data.
SFT with LoRA on mistral-hackaton-2026 org.
"""

from datasets import load_dataset
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig
import trackio

print("=" * 60)
print("CLAN ROYALE — Fine-tuning Ministral-8B-Instruct")
print("=" * 60)

# Load dataset from Hub
print("\n[1/5] Loading dataset from mistral-hackaton-2026/clan-royale-training-data...")
dataset = load_dataset("mistral-hackaton-2026/clan-royale-training-data", data_files={"train": "train.jsonl", "val": "val.jsonl"})
train_dataset = dataset["train"]
val_dataset = dataset["val"]
print(f"  Train: {len(train_dataset)} examples")
print(f"  Val:   {len(val_dataset)} examples")

# LoRA config for 8B model
print("\n[2/5] Configuring LoRA adapter...")
peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    task_type="CAUSAL_LM",
)
print(f"  r={peft_config.r}, alpha={peft_config.lora_alpha}, dropout={peft_config.lora_dropout}")
print(f"  Target modules: {peft_config.target_modules}")

# Training config
print("\n[3/5] Setting up SFT trainer...")
training_args = SFTConfig(
    output_dir="clan-royale-ministral-8b-ft",
    push_to_hub=True,
    hub_model_id="mistral-hackaton-2026/clan-royale-ministral-8b-ft",
    hub_strategy="every_save",

    # Training hyperparameters
    num_train_epochs=3,
    per_device_train_batch_size=1,
    gradient_accumulation_steps=8,
    learning_rate=1e-4,
    warmup_ratio=0.1,
    lr_scheduler_type="cosine",
    bf16=True,
    gradient_checkpointing=True,

    # Eval
    eval_strategy="steps",
    eval_steps=25,
    per_device_eval_batch_size=1,

    # Saving
    save_strategy="steps",
    save_steps=50,
    save_total_limit=3,

    # Logging
    logging_steps=5,
    report_to="trackio",
    project="clan-royale",
    run_name="ministral-8b-sft-v1",

    # Sequence length
    max_length=2048,
)

# Create trainer
trainer = SFTTrainer(
    model="mistralai/Ministral-8B-Instruct-2410",
    train_dataset=train_dataset,
    eval_dataset=val_dataset,
    peft_config=peft_config,
    args=training_args,
)

# Train
print("\n[4/5] Starting training...")
print(f"  Model: mistralai/Ministral-8B-Instruct-2410")
print(f"  Epochs: {training_args.num_train_epochs}")
print(f"  Batch size: {training_args.per_device_train_batch_size} x {training_args.gradient_accumulation_steps} grad accum = {training_args.per_device_train_batch_size * training_args.gradient_accumulation_steps} effective")
print(f"  Learning rate: {training_args.learning_rate}")
print(f"  Max length: {training_args.max_length}")
print(f"  Steps: ~{len(train_dataset) * 3 // 8}")
print("-" * 60)

trainer.train()

# Push to Hub
print("\n[5/5] Pushing model to Hub...")
trainer.push_to_hub()
print("\n" + "=" * 60)
print("DONE! Model pushed to: mistral-hackaton-2026/clan-royale-ministral-8b-ft")
print("=" * 60)
