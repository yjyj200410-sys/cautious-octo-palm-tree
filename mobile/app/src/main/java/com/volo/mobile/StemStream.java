package com.volo.mobile;

import java.io.*;

/** Committed PCM prefix of a growing WAV. Readers wait at the producer frontier. */
final class StemStream {
  final File folder;
  private long frames, total;
  private boolean finished, failed;

  StemStream(File folder) {
    this.folder = folder;
  }

  synchronized void commit(long frames, long total) {
    this.frames = frames;
    this.total = total;
    notifyAll();
  }

  synchronized void finish() {
    finished = true;
    notifyAll();
  }

  synchronized void cancel() {
    failed = true;
    notifyAll();
  }

  synchronized boolean available() {
    return !failed && (frames >= 24000 || (finished && frames > 0));
  }

  synchronized long milliseconds() {
    return frames * 1000 / 48000;
  }

  synchronized long totalMilliseconds() {
    return total * 1000 / 48000;
  }

  synchronized boolean complete() {
    return finished;
  }

  synchronized long totalFrames() {
    return total;
  }

  synchronized int readPcm(RandomAccessFile input, long frame, byte[] buffer) throws IOException {
    if (failed) throw new IOException("分轨已取消");
    int count = (int) Math.min(buffer.length, Math.max(0, (frames - frame) * 4));
    if (count == 0) return finished && frame >= frames ? -1 : 0;
    input.seek(44 + frame * 4);
    input.readFully(buffer, 0, count);
    return count;
  }
}
