/* AudioWorklet Processors for Voice Chat — runs off main thread */

class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const float32 = input[0];
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage({ type: 'mic-data', pcm16: pcm16.buffer }, [pcm16.buffer]);
    return true;
  }
}

class SpeakerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._offset = 0;
    this.port.onmessage = (e) => {
      if (e.data?.type === 'audio-data') {
        this._queue.push(new Float32Array(e.data.float32));
      } else if (e.data?.type === 'clear') {
        this._queue = [];
        this._offset = 0;
      }
    };
  }
  process(_, outputs) {
    const ch = outputs[0]?.[0];
    if (!ch) return true;
    let written = 0;
    while (written < ch.length && this._queue.length > 0) {
      const chunk = this._queue[0];
      const remaining = chunk.length - this._offset;
      const needed = ch.length - written;
      if (remaining <= needed) {
        ch.set(chunk.subarray(this._offset), written);
        written += remaining;
        this._queue.shift();
        this._offset = 0;
      } else {
        ch.set(chunk.subarray(this._offset, this._offset + needed), written);
        this._offset += needed;
        written += needed;
      }
    }
    for (let i = written; i < ch.length; i++) ch[i] = 0;
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
registerProcessor('speaker-processor', SpeakerProcessor);
