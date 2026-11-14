export function playClickSound() {
  if (typeof window !== 'undefined') {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.05);

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } catch (e) {}
  }
}

// 👇 НОВЫЙ ПРИЯТНЫЙ ЗВУК ДЛЯ УСПЕШНОГО СОЗДАНИЯ
export function playSuccessSound() {
  if (typeof window !== 'undefined') {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      
      const ctx = new AudioContext();
      const notes = [523.25, 659.25, 783.99]; // Ноты До, Ми, Соль (мажорный аккорд)
      
      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = 'triangle'; // Мягкий тембр
        osc.frequency.value = freq;
        
        // Звук становится громче и затухает
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05 + index * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4 + index * 0.1);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(ctx.currentTime + index * 0.1);
        osc.stop(ctx.currentTime + 0.5 + index * 0.1);
      });
    } catch (e) {}
  }
}