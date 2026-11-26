package com.volo.mobile;

import java.util.*;

/** Queue traversal independent of Android, decoding and browsing. */
final class PlaybackOrder {
  enum Mode {
    SEQUENTIAL,
    LIST_LOOP,
    SINGLE_LOOP,
    SHUFFLE
  }

  Mode mode = Mode.LIST_LOOP;
  private boolean shuffle;
  private final Random random;
  private final ArrayList<Integer> history = new ArrayList<>();
  private int cursor = -1;

  PlaybackOrder() {
    this(new Random());
  }

  PlaybackOrder(Random random) {
    this.random = random;
  }

  void reset() {
    history.clear();
    cursor = -1;
  }

  boolean isShuffled() {
    return shuffle || mode == Mode.SHUFFLE;
  }

  void setRepeat(Mode value) {
    if (value == Mode.SHUFFLE) {
      setShuffle(true);
      return;
    }
    shuffle = isShuffled();
    mode = value;
  }

  void setShuffle(boolean enabled) {
    boolean previous = isShuffled();
    if (mode == Mode.SHUFFLE) mode = Mode.LIST_LOOP;
    shuffle = enabled;
    if (previous != enabled) reset();
  }

  void restore(Mode value, boolean shuffle) {
    mode = value == Mode.SHUFFLE ? Mode.LIST_LOOP : value;
    this.shuffle = shuffle || value == Mode.SHUFFLE;
    reset();
  }

  // Shuffle the queue once. Both directions traverse the same permutation.
  private void prepareShuffle(int size, int current) {
    if (history.size() == size && cursor >= 0 && history.get(cursor) == current) return;
    history.clear();
    for (int i=0;i<size;i++) if (i!=current) history.add(i);
    Collections.shuffle(history,random);
    history.add(0,current);
    cursor=0;
  }

  int[] queueOrder(int size,int current) {
    int[] result=new int[size];
    if(isShuffled()&&current>=0&&current<size) {
      prepareShuffle(size,current);
      for(int i=0;i<size;i++)result[i]=history.get(i);
    } else for(int i=0;i<size;i++)result[i]=i;
    return result;
  }

  void moveDisplayed(int size,int current,int from,int to){
    if(!isShuffled()||from<0||to<0||from>=size||to>=size||from==to)return;
    prepareShuffle(size,current);history.add(to,history.remove(from));cursor=history.indexOf(current);
  }

  int peek(int size, int current, int direction) {
    if (size==0) return -1;
    if (current<0 || current>=size) return 0;
    if (!isShuffled()) return Math.floorMod(current+direction,size);
    prepareShuffle(size,current);
    return history.get(Math.floorMod(cursor+direction,size));
  }

  int next(int size, int current, boolean automatic) {
    if (size==0) return -1;
    if (current<0 || current>=size) return 0;
    if (automatic && mode==Mode.SINGLE_LOOP) return current;
    if (!isShuffled()) {
      if (automatic && mode==Mode.SEQUENTIAL && current==size-1) return -1;
      return (current+1)%size;
    }
    prepareShuffle(size,current);
    if (automatic && mode==Mode.SEQUENTIAL && cursor==size-1) return -1;
    cursor=(cursor+1)%size;
    return history.get(cursor);
  }

  int peekAutomatic(int size, int current) {
    if (size==0) return -1;
    if (current<0 || current>=size) return 0;
    if (mode==Mode.SINGLE_LOOP) return current;
    if (mode==Mode.SEQUENTIAL) {
      if (!isShuffled() && current==size-1) return -1;
      if (isShuffled()) {
        prepareShuffle(size,current);
        if (cursor==size-1) return -1;
      }
    }
    return peek(size,current,1);
  }

  int previous(int size, int current) {
    if (size==0) return -1;
    if (current<0 || current>=size) return 0;
    if (!isShuffled()) return Math.floorMod(current-1,size);
    prepareShuffle(size,current);
    cursor=Math.floorMod(cursor-1,size);
    return history.get(cursor);
  }
}
