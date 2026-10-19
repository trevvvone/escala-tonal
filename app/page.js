"use client";
import { useRef, useState } from "react";
const N = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const SC = { mayor: [0, 2, 4, 5, 7, 9, 11], menor: [0, 2, 3, 5, 7, 8, 10] };
export default function Page() {
  const [st, setSt] = useState("Listo"), [res, setRes] = useState(null), [busy, setBusy] = useState(false), [rec, setRec] = useState(false);
  const [tn, setTn] = useState(0), [md, setMd] = useState("mayor"), mr = useRef(null);

  function analizar(buf) { // AudioBuffer -> Web Worker
    setBusy(true); setSt("Analizando en un Web Worker…");
    const data = buf.getChannelData(0).slice(0, buf.sampleRate * 30), w = new Worker("/analyzer-worker.js");
    w.onmessage = (e) => { setRes(e.data); setBusy(false); setSt("Listo"); w.terminate(); };
    w.onerror = () => { setSt("Error en el análisis"); setBusy(false); };
    w.postMessage({ samples: data, sr: buf.sampleRate }, [data.buffer]);
  }
  async function decodificar(ab) {
    const ctx = new AudioContext();
    try { analizar(await ctx.decodeAudioData(ab)); } catch { setSt("No se pudo decodificar el audio"); } finally { ctx.close(); }
  }
  async function sintetizar() { // Web Audio API: osciladores en un OfflineAudioContext
    const sr = 44100, notas = [...SC[md], 12].map((i) => 60 + tn + i), oc = new OfflineAudioContext(1, sr * notas.length * 0.5, sr);
    notas.forEach((m, k) => {
      const o = oc.createOscillator(), g = oc.createGain();
      o.frequency.value = 440 * 2 ** ((m - 69) / 12);
      g.gain.setValueAtTime(0.5, k * 0.5); g.gain.linearRampToValueAtTime(0, k * 0.5 + 0.48);
      o.connect(g).connect(oc.destination); o.start(k * 0.5); o.stop(k * 0.5 + 0.5);
    });
    setSt("Sintetizando la escala…"); analizar(await oc.startRendering());
  }
  async function grabar() {
    if (rec) return mr.current.stop();
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }), m = new MediaRecorder(s), ch = [];
      m.ondataavailable = (e) => ch.push(e.data);
      m.onstop = async () => { s.getTracks().forEach((t) => t.stop()); setRec(false); decodificar(await new Blob(ch).arrayBuffer()); };
      mr.current = m; m.start(); setRec(true); setSt("Grabando… toca o canta una escala y pulsa Detener");
    } catch { setSt("No se pudo acceder al micrófono"); }
  }
  const k = res?.key, notas = k && SC[k.mode].map((i) => N[(k.tonic + i) % 12]);
  return (
    <main>
      <h1>Reconocedor de escala tonal</h1>
      <p className="s">FFT + autocorrelación + perfiles de tonalidad. Todo en un Web Worker, con Web Audio API y sin librerías.</p>
      <section className="c">
        <h2>1. Entrada de audio</h2>
        <button onClick={grabar} disabled={busy}>{rec ? "Detener grabación" : "Grabar con micrófono"}</button>
        <label>O sube un archivo de audio</label>
        <input type="file" accept="audio/*" disabled={busy} onChange={(e) => e.target.files[0] && e.target.files[0].arrayBuffer().then(decodificar)} />
        <label>O genera una escala de prueba</label>
        <div style={{ display: "flex", gap: 8 }}>
          <select value={tn} onChange={(e) => setTn(+e.target.value)}>{N.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
          <select value={md} onChange={(e) => setMd(e.target.value)}><option>mayor</option><option>menor</option></select>
        </div>
        <button className="o" onClick={sintetizar} disabled={busy}>Generar y analizar</button>
        <p>Estado: <code>{st}</code></p>
      </section>
      {res && (
        <section className="c" style={{ marginTop: 16 }}>
          <h2>2. Resultado</h2>
          <div className="big">{N[k.tonic]} {k.mode}</div>
          <p>Notas de la escala: <span className="chips">{notas.map((n, i) => <span key={i}>{n}</span>)}</span></p>
          <p>Perfil cromático (energía por nota):</p>
          <div className="bars">{res.chroma.map((v, i) => <div key={i} className={notas.includes(N[i]) ? "on" : ""}><span style={{ height: Math.max(2, (v / Math.max(...res.chroma)) * 90) }} />{N[i]}</div>)}</div>
          <table><thead><tr><th>Candidata</th><th>Correlación</th></tr></thead>
            <tbody>{res.ranking.map((c, i) => <tr key={i}><td>{N[c.tonic]} {c.mode}</td><td>{c.r.toFixed(3)}</td></tr>)}</tbody></table>
          <p>{res.frames} tramos analizados, {res.voiced} con tono detectado por autocorrelación, {res.ms} ms en el worker.</p>
        </section>
      )}
    </main>
  );
}
