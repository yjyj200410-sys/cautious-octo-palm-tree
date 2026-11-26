package com.volo.mobile;

/** Controlled remote acknowledgements; no live account writes. */
public final class FavoriteToggleTest {
  static int checks;

  static void check(boolean value) {
    if (!value) throw new AssertionError("Favorite state check " + checks);
    checks++;
  }

  public static void main(String[] args) {
    FavoriteToggle burst = new FavoriteToggle(false);
    for (int i = 0; i < 1000; i++) burst.choose(i % 2 == 0);
    check(burst.begin() == null); // Entire on/off burst cancels without remote writes.
    burst.choose(true);
    check(Boolean.TRUE.equals(burst.begin()));
    check(burst.begin() == null); // Only one write may be in flight.
    burst.choose(false);
    burst.complete(true);
    check(!burst.desired && burst.confirmed); // Old success does not undo the last tap.
    check(Boolean.FALSE.equals(burst.begin()));
    burst.complete(true);
    check(!burst.desired && !burst.confirmed && burst.begin() == null);

    FavoriteToggle back = new FavoriteToggle(false);
    back.choose(true);
    back.begin();
    back.choose(false);
    back.choose(true);
    back.complete(true);
    check(back.desired && back.confirmed && back.begin() == null);

    FavoriteToggle failure = new FavoriteToggle(false);
    failure.choose(true);
    failure.begin();
    check(failure.complete(false));
    check(!failure.desired && failure.begin() == null); // Latest failure rolls back once.

    FavoriteToggle newer = new FavoriteToggle(false);
    newer.choose(true);
    newer.begin();
    newer.choose(false);
    newer.choose(true);
    check(!newer.complete(false)); // Older failure cannot discard a newer equal-valued choice.
    check(newer.desired && Boolean.TRUE.equals(newer.begin()));
    check(newer.complete(false)); // A new failure without more taps ends the retry.
    check(!newer.desired && newer.begin() == null);
    System.out.println("PASS: " + checks + " focused favorite coalescing checks");
  }
}
