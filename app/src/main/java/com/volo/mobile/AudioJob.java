package com.volo.mobile;

import android.content.*;
import android.media.*;
import android.net.Uri;
import java.io.*;
import java.nio.*;
import java.util.function.*;

final class AudioJob {
  interface Progress {
    void update(String message);

    boolean cancelled();

    default void partial(long frames, long total) {}
  }

  static void run(Context context, Uri uri, File folder, Progress progress) throws Exception {
    File raw = new File(folder, "decoded.tmp");
    File vocal = new File(folder, "vocals.wav.part"),
        music = new File(folder, "accompaniment.wav.part");
    boolean success = false;
    try {
      progress.update("解码音频…");
      int rate = decode(context, uri, raw, progress);
      long frames = raw.length() / 8;
      long total = (long) Math.ceil(frames * 48000.0 / rate);
      if (total == 0 || total > 48000L * 60 * 60) throw new IOException("请选择时长不超过一小时的有效音频");
      byte[] model;
      try (InputStream stream = context.getAssets().open("model.onnx")) {
        model = stream.readAllBytes();
      }
      progress.update("加载本地模型…");
      long start = System.nanoTime();
      try (Separator separator = new Separator(model);
          RandomAccessFile source = new RandomAccessFile(raw, "r");
          RandomAccessFile v = new RandomAccessFile(vocal, "rw");
          RandomAccessFile a = new RandomAccessFile(music, "rw")) {
        v.setLength(0);
        a.setLength(0);
        v.write(new byte[44]);
        a.write(new byte[44]);
        header(v, total);
        header(a, total);
        float[] prior = new float[Separator.HISTORY * 2];
        long written = 0;
        for (long position = 0; position < total + Separator.HISTORY; position += Separator.BATCH) {
          if (progress.cancelled()) throw new InterruptedException("已取消");
          float[] pcm = new float[Separator.BATCH * 2];
          long first = position * rate / 48000,
              last =
                  Math.min(
                      frames, (long) Math.ceil((position + Separator.BATCH) * rate / 48000.0) + 1);
          byte[] bytes = new byte[(int) Math.max(0, last - first) * 8];
          if (bytes.length > 0) {
            source.seek(first * 8);
            source.readFully(bytes);
          }
          ByteBuffer block = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
          for (int n = 0; n < Separator.BATCH && position + n < total; n++) {
            double p = (position + n) * rate / 48000.0;
            int i = (int) (Math.floor(p) - first);
            double mix = p - Math.floor(p);
            for (int ch = 0; ch < 2; ch++) {
              float x = block.getFloat(i * 8 + ch * 4),
                  y = block.getFloat(Math.min(i + 1, bytes.length / 8 - 1) * 8 + ch * 4);
              pcm[ch * Separator.BATCH + n] = (float) (x + (y - x) * mix);
            }
          }
          float[] vocals = separator.process(pcm);
          ByteBuffer vb = ByteBuffer.allocate(Separator.BATCH * 4).order(ByteOrder.LITTLE_ENDIAN),
              ab = ByteBuffer.allocate(Separator.BATCH * 4).order(ByteOrder.LITTLE_ENDIAN);
          for (int n = 0; n < Separator.BATCH; n++) {
            long output = position - Separator.HISTORY + n;
            if (output < 0 || output >= total) continue;
            for (int ch = 0; ch < 2; ch++) {
              float original =
                  n < Separator.HISTORY
                      ? prior[ch * Separator.HISTORY + n]
                      : pcm[ch * Separator.BATCH + n - Separator.HISTORY];
              float voice = vocals[ch * Separator.BATCH + n];
              vb.putShort(quantize(voice));
              ab.putShort(quantize(original - voice));
            }
            written++;
          }
          v.write(vb.array(), 0, vb.position());
          a.write(ab.array(), 0, ab.position());
          progress.partial(written, total);
          for (int ch = 0; ch < 2; ch++)
            System.arraycopy(
                pcm,
                ch * Separator.BATCH + Separator.BATCH - Separator.HISTORY,
                prior,
                ch * Separator.HISTORY,
                Separator.HISTORY);
          if (position % (Separator.BATCH * 12) == 0)
            progress.update(
                "分轨 "
                    + Math.min(100, position * 100 / total)
                    + "% · 已用 "
                    + ((System.nanoTime() - start) / 1000000000)
                    + " 秒");
        }
        header(v, written);
        header(a, written);
      }
      if (!vocal.renameTo(new File(folder, "vocals.wav"))
          || !music.renameTo(new File(folder, "accompaniment.wav")))
        throw new IOException("保存结果失败");
      success = true;
      progress.update(
          "完成 · "
              + String.format(java.util.Locale.ROOT, "%.1f", total / 48000.0)
              + " 秒音频 · 处理耗时 "
              + ((System.nanoTime() - start) / 1000000000)
              + " 秒");
    } finally {
      raw.delete();
      if (!success) {
        vocal.delete();
        music.delete();
      }
    }
  }

  private static short quantize(float v) {
    return (short) Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  }

  private static void header(RandomAccessFile file, long frames) throws IOException {
    ByteBuffer b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
    b.put("RIFF".getBytes())
        .putInt((int) (36 + frames * 4))
        .put("WAVEfmt ".getBytes())
        .putInt(16)
        .putShort((short) 1)
        .putShort((short) 2)
        .putInt(48000)
        .putInt(192000)
        .putShort((short) 4)
        .putShort((short) 16)
        .put("data".getBytes())
        .putInt((int) (frames * 4));
    file.seek(0);
    file.write(b.array());
  }

  private static int decode(Context context, Uri uri, File raw, Progress progress)
      throws Exception {
    MediaExtractor extractor = new MediaExtractor();
    MediaCodec codec = null;
    try (BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(raw))) {
      extractor.setDataSource(context, uri, null);
      MediaFormat format = null;
      for (int t = 0; t < extractor.getTrackCount(); t++) {
        MediaFormat f = extractor.getTrackFormat(t);
        if (f.getString(MediaFormat.KEY_MIME).startsWith("audio/")) {
          extractor.selectTrack(t);
          format = f;
          break;
        }
      }
      if (format == null) throw new IOException("文件中没有音轨");
      int rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE),
          channels = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT),
          encoding = AudioFormat.ENCODING_PCM_16BIT;
      codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME));
      codec.configure(format, null, null, 0);
      codec.start();
      boolean inputEnd = false, outputEnd = false;
      MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
      long limit = System.nanoTime() + 600_000_000_000L;
      while (!outputEnd) {
        if (progress.cancelled()) throw new InterruptedException("已取消");
        if (System.nanoTime() > limit) throw new IOException("解码超时");
        if (!inputEnd) {
          int i = codec.dequeueInputBuffer(10000);
          if (i >= 0) {
            ByteBuffer b = codec.getInputBuffer(i);
            int size = extractor.readSampleData(b, 0);
            if (size < 0) {
              codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
              inputEnd = true;
            } else {
              codec.queueInputBuffer(i, 0, size, extractor.getSampleTime(), 0);
              extractor.advance();
            }
          }
        }
        int i = codec.dequeueOutputBuffer(info, 10000);
        if (i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          MediaFormat f = codec.getOutputFormat();
          rate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE);
          channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
          encoding =
              f.containsKey(MediaFormat.KEY_PCM_ENCODING)
                  ? f.getInteger(MediaFormat.KEY_PCM_ENCODING)
                  : AudioFormat.ENCODING_PCM_16BIT;
        } else if (i >= 0) {
          try {
            ByteBuffer b = codec.getOutputBuffer(i).order(ByteOrder.LITTLE_ENDIAN);
            b.position(info.offset);
            b.limit(info.offset + info.size);
            int sampleBytes = encoding == AudioFormat.ENCODING_PCM_FLOAT ? 4 : 2;
            if (encoding != AudioFormat.ENCODING_PCM_FLOAT
                && encoding != AudioFormat.ENCODING_PCM_16BIT)
              throw new IOException("暂不支持此 PCM 编码");
            ByteBuffer encoded =
                ByteBuffer.allocate((info.size / (sampleBytes * channels)) * 8)
                    .order(ByteOrder.LITTLE_ENDIAN);
            while (b.remaining() >= sampleBytes * channels) {
              float left = 0, right = 0;
              for (int ch = 0; ch < channels; ch++) {
                float sample = sampleBytes == 4 ? b.getFloat() : b.getShort() / 32768f;
                if (ch == 0) left = sample;
                if (ch == 1) right = sample;
              }
              encoded.putFloat(left).putFloat(channels == 1 ? left : right);
            }
            out.write(encoded.array(), 0, encoded.position());
            if (raw.length() > 1_500_000_000L) throw new IOException("音频文件过大");
            outputEnd = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0;
          } finally {
            codec.releaseOutputBuffer(i, false);
          }
        }
      }
      return rate;
    } finally {
      if (codec != null) {
        try {
          codec.stop();
        } finally {
          codec.release();
        }
      }
      extractor.release();
    }
  }
}
