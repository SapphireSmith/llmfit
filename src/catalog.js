export const MODEL_CATALOG = [
  {
    name: "Llama 3.2 1B Instruct",
    params: "1B",
    quantization: "Q4_K_M",
    minimumRamGb: 4,
    recommendedRamGb: 8,
    fitsLevel: "easy",
    notes: "Very lightweight. Good for basic experimentation and fast local runs."
  },
  {
    name: "Qwen2.5 3B Instruct",
    params: "3B",
    quantization: "Q4_K_M",
    minimumRamGb: 6,
    recommendedRamGb: 8,
    fitsLevel: "easy",
    notes: "A solid small model for everyday prompting with modest hardware."
  },
  {
    name: "Llama 3.1 8B Instruct",
    params: "8B",
    quantization: "Q4_K_M",
    minimumRamGb: 12,
    recommendedRamGb: 16,
    fitsLevel: "good",
    notes: "Popular balance of quality and local usability for many laptops and desktops."
  },
  {
    name: "Mistral 7B Instruct v0.3",
    params: "7B",
    quantization: "Q4_K_M",
    minimumRamGb: 12,
    recommendedRamGb: 16,
    fitsLevel: "good",
    notes: "Strong general-purpose option for local use."
  },
  {
    name: "Qwen2.5 7B Instruct",
    params: "7B",
    quantization: "Q4_K_M",
    minimumRamGb: 12,
    recommendedRamGb: 16,
    fitsLevel: "good",
    notes: "Good multilingual and coding-leaning option at the 7B size."
  },
  {
    name: "Llama 3.1 14B Instruct",
    params: "14B",
    quantization: "Q4_K_M",
    minimumRamGb: 24,
    recommendedRamGb: 32,
    fitsLevel: "stretch",
    notes: "Better quality, but more demanding. Best on higher-memory systems."
  }
];
