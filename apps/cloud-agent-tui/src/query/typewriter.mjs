export async function typewriter(text, { delayMs = 8, stream = process.stdout } = {}) {
  for (const char of String(text)) {
    stream.write(char);
    if (delayMs > 0 && !/\s/.test(char)) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

export async function printBlock(text) {
  await typewriter(text);
  process.stdout.write("\n");
}
