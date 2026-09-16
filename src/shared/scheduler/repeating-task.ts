/**
 * Roda `task` de novo só depois que a execução anterior terminou (nunca usa
 * `setInterval` puro pra isso. se uma execução atrasar, o setInterval empilha
 * a próxima por cima, rodando duas ao mesmo tempo). `intervalMs` é a pausa
 * entre o fim de uma execução e o início da próxima
 * Retorna uma função pra parar o loop (usada no shutdown do processo)
 */
export function startRepeatingTask(
  intervalMs: number,
  task: () => Promise<void>,
  onError: (err: unknown) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const tick = async (): Promise<void> => {
    if (stopped) {
      return;
    }
    try {
      await task();
    } catch (err) {
      onError(err);
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, 0);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
    }
  };
}
