package com.volo.mobile;

import java.io.*;
import java.nio.file.*;

public final class StemStreamTest {
  public static void main(String[] args) throws Exception {
    File folder = Files.createTempDirectory("volo-prefix-test").toFile(),
        file = new File(folder, "vocals.wav.part");
    try (RandomAccessFile out = new RandomAccessFile(file, "rw");
        RandomAccessFile in = new RandomAccessFile(file, "r")) {
      out.write(new byte[44]);
      out.write(new byte[] {1, 2, 3, 4, 5, 6, 7, 8});
      StemStream stream = new StemStream(folder);
      stream.commit(1, 2);
      byte[] bytes = new byte[8];
      if (stream.readPcm(in, 0, bytes) != 4 || bytes[0] != 1)
        throw new AssertionError("exposed uncommitted bytes");
      if (stream.readPcm(in, 1, bytes) != 0) throw new AssertionError("frontier must wait");
      stream.commit(2, 2);
      if (stream.readPcm(in, 1, bytes) != 4 || bytes[0] != 5)
        throw new AssertionError("new prefix unreadable");
      if (stream.readPcm(in, 2, bytes) != 0) throw new AssertionError("premature EOF");
      stream.finish();
      if (stream.readPcm(in, 2, bytes) != -1) throw new AssertionError("missing final EOF");
      stream.cancel();
      if (stream.available()) throw new AssertionError("cancelled stream remains selectable");
      try {
        stream.readPcm(in, 0, bytes);
        throw new AssertionError("cancelled read succeeded");
      } catch (IOException expected) {
      }
    } finally {
      file.delete();
      folder.delete();
    }
    System.out.println("PASS: committed prefix, frontier, resume, final EOF and cancellation");
  }
}
