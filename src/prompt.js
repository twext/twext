import { createInterface } from "node:readline";

export function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const { stdin, stdout } = process;
    if (!stdin.isTTY) {
      const chunks = [];
      stdin.on("data", (chunk) => chunks.push(chunk));
      stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").trimEnd()));
      return;
    }
    if (hidden) {
      let value = "";
      stdout.write(question);
      stdin.setRawMode(true);
      stdin.resume();
      const onData = (chunk) => {
        for (const code of chunk) {
          if (code === 3) process.exit(130);
          if (code === 13 || code === 10) {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.removeListener("data", onData);
            stdout.write("\n");
            return resolve(value);
          }
          if (code === 127 || code === 8) value = value.slice(0, -1);
          else value += String.fromCharCode(code);
        }
      };
      stdin.on("data", onData);
      return;
    }
    const readline = createInterface({ input: stdin, output: stdout });
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}
