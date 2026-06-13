import os from "node:os";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function bytesToGb(bytes) {
  return Math.round((bytes / 1024 ** 3) * 10) / 10;
}

async function safeExec(command, execImpl = execAsync) {
  try {
    const { stdout, stderr } = await execImpl(command, { timeout: 5000 });
    return { stdout: (stdout ?? "").trim(), stderr: (stderr ?? "").trim(), error: null };
  } catch (error) {
    return { stdout: "", stderr: "", error };
  }
}

export async function detectGpus({ platform = os.platform(), execImpl = execAsync } = {}) {
  const gpus = [];

  // 1. Try nvidia-smi first across all platforms
  const { stdout: nvidiaSmiOut } = await safeExec(
    "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
    execImpl
  );
  if (nvidiaSmiOut) {
    const lines = nvidiaSmiOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const parts = line.split(",").map((p) => p.trim());
      if (parts.length >= 2) {
        const model = parts[0];
        const vramMb = Number.parseFloat(parts[1]);
        if (!Number.isNaN(vramMb)) {
          gpus.push({
            model,
            vramGb: Math.round((vramMb / 1024) * 10) / 10
          });
        }
      }
    }
    if (gpus.length > 0) {
      return gpus;
    }
  }

  // 2. Platform-specific fallback
  if (platform === "win32") {
    const psCommand = 'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json"';
    const { stdout: psOut } = await safeExec(psCommand, execImpl);
    if (psOut) {
      try {
        const data = JSON.parse(psOut);
        const controllers = Array.isArray(data) ? data : [data];
        for (const item of controllers) {
          if (item && item.Name) {
            const vramBytes = Math.abs(Number(item.AdapterRAM));
            // Handle negative values or Windows 32-bit WMI limits (like 4294967295)
            let vramGb = null;
            if (vramBytes > 0 && item.AdapterRAM !== 4294967295) {
              vramGb = bytesToGb(vramBytes);
            }
            gpus.push({
              model: item.Name,
              vramGb
            });
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  } else if (platform === "darwin") {
    const { stdout: macOut } = await safeExec("system_profiler SPDisplaysDataType -json 2>/dev/null", execImpl);
    if (macOut) {
      try {
        const data = JSON.parse(macOut);
        const controllers = data.SPDisplaysDataType || [];
        for (const item of controllers) {
          const model = item.sppci_model || item._name || "Unknown Apple GPU";
          const vramText = item.spdisplays_vram || item.spdisplays_vram_shared || "";
          let vramGb = null;
          if (vramText) {
            const match = vramText.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
            if (match) {
              const val = Number.parseFloat(match[1]);
              const unit = match[2].toUpperCase();
              if (unit === "GB") {
                vramGb = val;
              } else if (unit === "MB") {
                vramGb = Math.round((val / 1024) * 10) / 10;
              }
            }
          }
          gpus.push({
            model,
            vramGb
          });
        }
      } catch {
        // Ignore
      }
    }
  } else if (platform === "linux") {
    const { stdout: lspciOut } = await safeExec("lspci -mm", execImpl);
    if (lspciOut) {
      const lines = lspciOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (line.includes("VGA") || line.includes("3D") || line.includes("Display")) {
          const matches = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
          if (matches.length >= 3) {
            const vendor = matches[1];
            const model = matches[2];
            gpus.push({
              model: `${vendor} ${model}`,
              vramGb: null
            });
          }
        }
      }
    }
  }

  return gpus;
}
