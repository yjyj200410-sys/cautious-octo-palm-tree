package com.volo.mobile;

import android.media.*;
import java.io.*;

/** Bounded PCM consumer. Its playback head stops naturally at a producer underrun. */
final class LiveStemPlayer implements AutoCloseable {
  interface Events {
    void ended();

    void failed(String message);
  }

  private final AudioTrack track;
  private final RandomAccessFile input;
  private final StemStream stream;
  private final Thread worker;
  private final Events events;
  private boolean closed, playing, ended;
  private long base, sent;

  LiveStemPlayer(StemStream stream, String name, int position, Events events) throws IOException {
    this.stream = stream;
    this.events = events;
    File file = new File(stream.folder, name + ".part");
    if (!file.isFile()) file = new File(stream.folder, name);
    input = new RandomAccessFile(file, "r");
    int minimum =
        AudioTrack.getMinBufferSize(
            48000, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_16BIT);
    track =
        new AudioTrack.Builder()
            .setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
            .setAudioFormat(
                new AudioFormat.Builder()
                    .setSampleRate(48000)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .build())
            .setBufferSizeInBytes(Math.max(minimum, 16384))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build();
    if (track.getState() != AudioTrack.STATE_INITIALIZED) {
      track.release();
      input.close();
      throw new IOException("无法创建分轨试听通道");
    }
    base = sent = Math.min(stream.totalFrames(), Math.max(0, position) * 48L);
    worker = new Thread(this::consume, "Doto-live-stems");
    worker.start();
  }

  private void consume() {
    byte[] bytes = new byte[8192];
    try {
      while (true) {
        synchronized (this) {
          if (closed) return;
          if (playing) {
            int count = stream.readPcm(input, sent, bytes);
            if (count < 0) {
              if (positionFrames() >= sent && !ended) {
                ended = true;
                playing = false;
                track.pause();
                events.ended();
              }
            } else if (count > 0) {
              int n = track.write(bytes, 0, count, AudioTrack.WRITE_NON_BLOCKING);
              if (n < 0) throw new IOException("试听写入失败：" + n);
              sent += n / 4;
            }
          }
        }
        Thread.sleep(10);
      }
    } catch (InterruptedException ignored) {
      Thread.currentThread().interrupt();
    } catch (Exception e) {
      synchronized (this) {
        if (!closed) {
          playing = false;
          events.failed(e.getMessage());
        }
      }
    }
  }

  private long positionFrames() {
    return base + Integer.toUnsignedLong(track.getPlaybackHeadPosition());
  }

  synchronized int position() {
    return (int) Math.min(stream.totalMilliseconds(), positionFrames() / 48);
  }


  int duration() {
    return (int) stream.totalMilliseconds();
  }

  synchronized boolean playing() {
    return playing;
  }

  synchronized void play() {
    if (!closed) {
      ended = false;
      playing = true;
      track.play();
    }
  }

  synchronized void pause() {
    if (!closed) {
      playing = false;
      track.pause();
    }
  }

  synchronized void volume(float volume) {
    if (!closed) track.setVolume(volume);
  }

  synchronized void seek(int ms) {
    if (closed) return;
    track.pause();
    track.flush();
    base = sent = Math.min(Math.max(0, ms) * 48L, stream.totalFrames());
    ended = false;
    if (playing) track.play();
  }

  public synchronized void close() {
    if (closed) return;
    closed = true;
    playing = false;
    worker.interrupt();
    track.pause();
    track.flush();
    track.release();
    try {
      input.close();
    } catch (IOException ignored) {
    }
  }
}
