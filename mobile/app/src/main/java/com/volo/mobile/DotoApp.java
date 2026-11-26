package com.volo.mobile;

import android.app.Activity;
import android.app.Application;
import android.os.Bundle;
import android.os.SystemClock;

public final class DotoApp extends Application implements Application.ActivityLifecycleCallbacks {
  private int visibleActivities;
  private boolean mainScreenCreated;
  private long leftAt = -2000;
  Runnable visibilityChanged;

  @Override public void onCreate() {
    super.onCreate();
    registerActivityLifecycleCallbacks(this);
  }

  boolean isFirstMainScreen() {
    boolean first = !mainScreenCreated;
    mainScreenCreated = true;
    return first;
  }

  long lyricsDelay() {
    return visibleActivities > 0 ? -1 : Math.max(0, leftAt + 2000 - SystemClock.uptimeMillis());
  }

  @Override public void onActivityStarted(Activity activity) {
    visibleActivities++;
    if (visibilityChanged != null) visibilityChanged.run();
  }

  @Override public void onActivityStopped(Activity activity) {
    if (--visibleActivities == 0) leftAt = SystemClock.uptimeMillis();
    if (visibilityChanged != null) visibilityChanged.run();
  }

  @Override public void onActivityCreated(Activity activity, Bundle state) {}
  @Override public void onActivityResumed(Activity activity) {}
  @Override public void onActivityPaused(Activity activity) {}
  @Override public void onActivitySaveInstanceState(Activity activity, Bundle state) {}
  @Override public void onActivityDestroyed(Activity activity) {}
}
