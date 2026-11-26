package com.volo.mobile;

import ai.onnxruntime.*;
import java.nio.*;
import java.util.*;

/** Streaming port of the desktop ColorOS MSS pipeline. One instance per song. */
public final class Separator implements AutoCloseable {
  public static final int BATCH = 4096, HISTORY = 1536, FFT = 2048;
  private final OrtEnvironment env = OrtEnvironment.getEnvironment();
  private final OrtSession session;
  private final LinkedHashMap<String, OnnxTensor> state = new LinkedHashMap<>();
  private OrtSession.Result previous;
  private final double[] window = new double[FFT],
      real = new double[FFT],
      imag = new double[FFT],
      overlap = new double[7168],
      denom = new double[7168];
  private final int[] reverse = new int[FFT];
  private final double[] cosine = new double[1024], sine = new double[1024];
  private final float[] history = new float[HISTORY * 2],
      spectra = new float[3 * 4 * 1024],
      input = new float[8 * 4 * 1024];

  public Separator(byte[] model) throws Exception {
    try (OrtSession.SessionOptions options = new OrtSession.SessionOptions()) {
      options.setIntraOpNumThreads(2);
      options.setInterOpNumThreads(1);
      session = env.createSession(model, options);
    }
    if (session.getInputNames().size() != 29) throw new IllegalStateException("模型接口不匹配");
    for (var entry : session.getInputInfo().entrySet())
      if (!entry.getKey().equals("input_1")) {
        long[] shape = ((TensorInfo) entry.getValue().getInfo()).getShape();
        int count = 1;
        for (long n : shape) count *= n;
        state.put(
            entry.getKey(),
            OnnxTensor.createTensor(env, FloatBuffer.wrap(new float[count]), shape));
      }
    for (int n = 0; n < FFT; n++) {
      window[n] = (float) (0.54 - 0.46 * Math.cos(2 * Math.PI * n / (FFT - 1)));
      reverse[n] = Integer.reverse(n) >>> 21;
    }
    for (int n = 0; n < 1024; n++) {
      cosine[n] = Math.cos(2 * Math.PI * n / FFT);
      sine[n] = Math.sin(2 * Math.PI * n / FFT);
    }
    for (int f = 0; f < 11; f++)
      for (int n = 0; n < FFT; n++) denom[f * 512 + n] += window[n] * window[n];
  }

  private void fft(boolean inverse) {
    for (int n = 0; n < FFT; n++) {
      int o = reverse[n];
      if (o > n) {
        double a = real[n], b = imag[n];
        real[n] = real[o];
        imag[n] = imag[o];
        real[o] = a;
        imag[o] = b;
      }
    }
    for (int size = 2; size <= FFT; size *= 2)
      for (int base = 0; base < FFT; base += size)
        for (int n = 0; n < size / 2; n++) {
          double c = cosine[n * (FFT / size)], s = sine[n * (FFT / size)] * (inverse ? 1 : -1);
          int a = base + n, b = a + size / 2;
          double r = real[b] * c - imag[b] * s, i = real[b] * s + imag[b] * c;
          real[b] = real[a] - r;
          imag[b] = imag[a] - i;
          real[a] += r;
          imag[a] += i;
        }
    if (inverse) for (int n = 0; n < FFT; n++) real[n] /= FFT;
  }

  public float[] process(float[] pcm) throws Exception {
    for (int f = 0; f < 8; f++)
      for (int ch = 0; ch < 2; ch++) {
        for (int n = 0; n < FFT; n++) {
          int p = f * 512 + n - HISTORY;
          real[n] = (p < 0 ? history[ch * HISTORY + p + HISTORY] : pcm[ch * BATCH + p]) * window[n];
          imag[n] = 0;
        }
        fft(false);
        int off = (f * 4 + ch * 2) * 1024;
        for (int n = 0; n < 1024; n++) {
          input[off + n] = (float) real[n];
          input[off + 1024 + n] = (float) imag[n];
        }
      }
    for (int ch = 0; ch < 2; ch++)
      System.arraycopy(pcm, ch * BATCH + BATCH - HISTORY, history, ch * HISTORY, HISTORY);
    Map<String, OnnxTensor> feeds = new HashMap<>();
    if (previous == null) feeds.putAll(state);
    else
      for (int i = 1; i < 29; i++)
        feeds.put("input_" + (i + 1), (OnnxTensor) previous.get("Identity_" + i).get());
    OrtSession.Result next;
    try (OnnxTensor tensor =
        OnnxTensor.createTensor(env, FloatBuffer.wrap(input), new long[] {1, 8, 4, 1024})) {
      feeds.put("input_1", tensor);
      next = session.run(feeds);
    }
    if (previous != null) previous.close();
    previous = next;
    float[] planes = new float[8 * 16 * 1024];
    ((OnnxTensor) next.get("Identity").get()).getFloatBuffer().get(planes);
    float[] vocals = new float[BATCH * 2];
    for (int ch = 0; ch < 2; ch++) {
      Arrays.fill(overlap, 0);
      for (int n = 0; n < 1024; n++) {
        cosine[n] = Math.cos(2 * Math.PI * n / FFT);
        sine[n] = Math.sin(2 * Math.PI * n / FFT);
      }
      for (int f = 0; f < 11; f++) {
        float[] data = f < 3 ? spectra : planes;
        int off = ((f < 3 ? f * 4 : (f - 3) * 16) + ch * 2) * 1024;
        Arrays.fill(real, 0);
        Arrays.fill(imag, 0);
        for (int n = 0; n < 1024; n++) {
          real[n] = data[off + n];
          imag[n] = data[off + 1024 + n];
          if (n > 0) {
            real[FFT - n] = real[n];
            imag[FFT - n] = -imag[n];
          }
        }
        fft(true);
        for (int n = 0; n < FFT; n++) overlap[f * 512 + n] += real[n] * window[n];
      }
      for (int n = 0; n < BATCH; n++) {
        float v = (float) (overlap[HISTORY + n] / denom[HISTORY + n]);
        if (!Float.isFinite(v)) throw new IllegalStateException("非有限模型输出");
        vocals[ch * BATCH + n] = v;
      }
    }
    for (int f = 0; f < 3; f++)
      System.arraycopy(planes, (f + 5) * 16 * 1024, spectra, f * 4 * 1024, 4 * 1024);
    return vocals;
  }

  public void close() throws OrtException {
    if (previous != null) previous.close();
    for (OnnxTensor t : state.values()) t.close();
    session.close();
  }
}
