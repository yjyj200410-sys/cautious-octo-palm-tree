package com.volo.mobile;

/** Main-thread state for coalescing taps while a single remote write is in flight. */
final class FavoriteToggle {
  boolean confirmed, desired, inFlight;
  private boolean sent;
  private long revision, sentRevision;

  FavoriteToggle(boolean initial) {
    confirmed = desired = initial;
  }

  void choose(boolean value) {
    desired = value;
    revision++;
  }

  Boolean begin() {
    if (inFlight || desired == confirmed) return null;
    inFlight = true;
    sent = desired;
    sentRevision = revision;
    return sent;
  }

  /** Returns true only when a failure rolls back the latest user choice. */
  boolean complete(boolean success) {
    if (!inFlight) throw new IllegalStateException("No favorite write in flight");
    inFlight = false;
    if (success) confirmed = sent;
    else if (revision == sentRevision) {
      desired = confirmed;
      return true;
    }
    return false;
  }
}
