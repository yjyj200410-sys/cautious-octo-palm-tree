package com.volo.mobile;

import android.app.AlertDialog;
import android.content.Context;
import android.view.*;
import android.widget.*;
import java.util.*;
import org.json.*;

/** Cover-led playlist detail. Browsing is independent of the service's active queue. */
final class SongListPanel extends LinearLayout {
  interface Actions {
    void play(int index, boolean shuffle);

    void next(int index);

    void append(int index);

    void download(int[] indices);

    void player(int index);
  }

  private final JSONArray songs;
  private final boolean searchResults;
  private final JSONObject sourceInfo;
  private final Actions actions;
  private final ArtworkLoader images;
  private final Set<String> downloaded, stems;
  private final ViewGroup rows;
  private final ArrayList<Row> rendered = new ArrayList<>();
  private TextView moreRows;
  private String currentId = "";
  private boolean playing,selecting;
  private final Set<Integer> selection=new TreeSet<>();
  private FrameLayout selectionDrawer;
  private TextView selectButton,allButton;
  private void refreshSelection(){
    setPadding(getPaddingLeft(),getPaddingTop(),getPaddingRight(),selecting?dp(64):0);allButton.setVisibility(selecting?VISIBLE:GONE);selectButton.setText(selecting?"完成":"多选");allButton.setText(selection.size()==songs.length()&&songs.length()>0?"取消全选":"全选");
    for(Row row:rendered){row.check.setVisibility(selecting?VISIBLE:GONE);row.check.setText(selection.contains(row.index)?"●":"○");row.check.setContentDescription(selection.contains(row.index)?"已选中":"未选中");row.more.setVisibility(selecting?GONE:VISIBLE);}
  }
  private void toggleSelection(int index){if(!selection.add(index))selection.remove(index);refreshSelection();}
  private void finishSelection(){selecting=false;selection.clear();removeSelectionDrawer();refreshSelection();}
  private void showSelectionDrawer(){
    LinearLayout bar=new LinearLayout(getContext());bar.setPadding(dp(8),0,dp(8),0);bar.setBackground(DotoDesign.cardSurface(getContext(),16));
    String[] labels={"下一首播放","加入歌单","下载","删除"};
    for(int i=0;i<4;i++){final int action=i;TextView option=GlassUi.label(getContext(),labels[i],13,true);option.setGravity(Gravity.CENTER);option.setTextColor(DotoDesign.CARD_INK);bar.addView(option,new LayoutParams(0,-1,1));GlassUi.touch(option,()->{
      if(selection.isEmpty()){Toast.makeText(getContext(),"请先选择歌曲",Toast.LENGTH_SHORT).show();return;}
      int[] indices=selection.stream().mapToInt(Integer::intValue).toArray();JSONArray chosen=new JSONArray();for(int index:indices)chosen.put(songs.optJSONObject(index));
      if(action==0){for(int n=indices.length-1;n>=0;n--)actions.next(indices[n]);finishSelection();}
      else if(action==2){actions.download(indices);finishSelection();}
      else if(getContext() instanceof MusicActivity activity){if(action==1)activity.chooseSongsPlaylist(chosen);else activity.deleteSelectedSongs(chosen,sourceInfo);finishSelection();}
    });}
    if(!(getContext() instanceof android.app.Activity activity))return;
    selectionDrawer=new FrameLayout(getContext()){
      private int actionBottom;
      @Override protected void onMeasure(int width,int height){
        setMeasuredDimension(MeasureSpec.getSize(width),MeasureSpec.getSize(height));
        actionBottom=FloatingNavigation.navigationTop(
            activity, activity.getWindowManager().getCurrentWindowMetrics())-dp(8);
        bar.measure(MeasureSpec.makeMeasureSpec(Math.max(0,getMeasuredWidth()-dp(24)),MeasureSpec.EXACTLY),MeasureSpec.makeMeasureSpec(dp(52),MeasureSpec.EXACTLY));
      }
      @Override protected void onLayout(boolean changed,int l,int t,int r,int b){
        int[] location=new int[2];getLocationOnScreen(location);
        int bottom=actionBottom-location[1];
        bar.layout(dp(12),bottom-bar.getMeasuredHeight(),getWidth()-dp(12),bottom);
      }
    };
    selectionDrawer.setClipChildren(false);selectionDrawer.setClipToPadding(false);selectionDrawer.setClickable(false);selectionDrawer.addView(bar);bar.setElevation(dp(4));
    activity.addContentView(selectionDrawer,new android.view.ViewGroup.LayoutParams(-1,-1));
  }
  private void removeSelectionDrawer(){if(selectionDrawer!=null){if(selectionDrawer.getParent() instanceof android.view.ViewGroup parent)parent.removeView(selectionDrawer);selectionDrawer=null;}}
  protected void onDetachedFromWindow(){removeSelectionDrawer();super.onDetachedFromWindow();}
  private GlassUi.Surface coverHero;
  private ImageView coverImage;
  void updateCover(String url){if(coverHero!=null&&coverImage!=null){images.into(coverImage,url);images.load(url,coverHero::blurredCover);}}
  private PlaylistFavorite favoriteIcon;
  void updatePlaylistFavorite(long id,boolean collected){if(sourceInfo.optLong("id")==id&&favoriteIcon!=null){favoriteIcon.collected=collected;favoriteIcon.describe();favoriteIcon.invalidate();}}
  private final class PlaylistFavorite extends View{
    boolean collected;final android.graphics.Paint paint=new android.graphics.Paint(3);final android.graphics.Path path=new android.graphics.Path();
    PlaylistFavorite(Context context,boolean collected){super(context);this.collected=collected;describe();}
    void describe(){setContentDescription(collected?"取消收藏歌单":"收藏歌单");setSelected(collected);}
    protected void onDraw(android.graphics.Canvas canvas){super.onDraw(canvas);canvas.save();canvas.translate(getWidth()/2f,getHeight()/2f);float density=getResources().getDisplayMetrics().density;canvas.scale(density,density);paint.setColor(collected?DotoDesign.FAVORITE:DotoDesign.CARD_INK);paint.setStrokeWidth(1.9f);paint.setStrokeJoin(android.graphics.Paint.Join.ROUND);paint.setStyle(collected?android.graphics.Paint.Style.FILL:android.graphics.Paint.Style.STROKE);path.reset();path.moveTo(0,10);path.cubicTo(-3,7,-12,1,-12,-5);path.cubicTo(-12,-12,-3,-14,0,-7);path.cubicTo(3,-14,12,-12,12,-5);path.cubicTo(12,1,3,7,0,10);path.close();canvas.drawPath(path,paint);canvas.restore();}
  }

  private int dp(float value) {
    return GlassUi.dp(getContext(), value);
  }

  SongListPanel(
      Context c,
      String title,
      JSONObject info,
      JSONArray songs,
      ArtworkLoader images,
      Set<String> downloaded,
      Set<String> stems,
      Actions actions) {
    super(c);
    setOrientation(VERTICAL);
    this.songs = songs;
    this.sourceInfo=info;
    this.searchResults=info.optBoolean("searchResults",false);
    this.images = images;
    this.downloaded = downloaded;
    this.stems = stems;
    this.actions = actions;
    GlassUi.Surface hero = new GlassUi.Surface(c, 22);
    LinearLayout header = new LinearLayout(c);
    header.setGravity(Gravity.CENTER_VERTICAL);
    header.setPadding(dp(12), dp(14), dp(12), dp(14));
    hero.addView(header, new FrameLayout.LayoutParams(-1, -2));
    addView(hero, new LayoutParams(-1, -2));
    coverHero=hero;
    ImageView cover = GlassUi.art(c, 13);coverImage=cover;
    String coverUrl = info.optString("coverImgUrl", info.optString("picUrl"));
    if (coverUrl.isEmpty() && songs.length() > 0) coverUrl = artUrl(songs.optJSONObject(0));
    images.into(cover, coverUrl);
    images.load(coverUrl, hero::blurredCover);
    cover.setContentDescription("歌单封面");
    header.addView(cover, new LayoutParams(dp(88), dp(88)));
    LinearLayout details = MobileUi.column(c);
    details.setPadding(dp(13), 0, 0, 0);
    header.addView(details, new LayoutParams(0, -2, 1));
    TextView name = GlassUi.label(c, title, 21, true);
    name.setMaxLines(2);
    name.setEllipsize(android.text.TextUtils.TruncateAt.END);
    details.addView(name, new LayoutParams(-1, -2));
    JSONObject creator = info.optJSONObject("creator");
    if (creator != null && !creator.optString("nickname").isEmpty()) {
      LinearLayout owner = new LinearLayout(c);
      owner.setGravity(Gravity.CENTER_VERTICAL);
      ImageView avatar = GlassUi.art(c, 9);
      images.into(avatar, creator.optString("avatarUrl"));
      owner.addView(avatar, new LayoutParams(dp(18), dp(18)));
      TextView ownerName = GlassUi.label(c, creator.optString("nickname"), 11, false);
      ownerName.setTextColor(GlassUi.MUTED);
      ownerName.setSingleLine();
      ownerName.setEllipsize(android.text.TextUtils.TruncateAt.END);
      LayoutParams op = new LayoutParams(-1, dp(24));
      op.leftMargin = dp(6);
      owner.addView(ownerName, op);
      LayoutParams lp = new LayoutParams(-1, dp(24));
      lp.topMargin = dp(6);
      details.addView(owner, lp);
    }
    TextView summary = GlassUi.label(c, summary(info, songs), 11, false);
    summary.setTextColor(DotoDesign.MUTED);
    summary.setMaxLines(2);
    LayoutParams sp = new LayoutParams(-1, -2);
    sp.topMargin = dp(8);
    details.addView(summary, sp);
    String description =
        info.isNull("description")
            ? ""
            : info.optString("description", "").trim().replace('\n', ' ');
    if (!description.isEmpty()) {
      TextView text = GlassUi.label(c, description, 11, false);
      text.setTextColor(GlassUi.MUTED);
      text.setMaxLines(2);
      text.setEllipsize(android.text.TextUtils.TruncateAt.END);
      LayoutParams lp = new LayoutParams(-1, -2);
      lp.topMargin = dp(8);
      details.addView(text, lp);
    }
    hero.setBackground(DotoDesign.cardSurface(c,24));
    DotoDesign.onPaper(header);
    if(c instanceof MusicActivity activity&&activity.showPlaylistFavorite(info)){
      header.setPadding(dp(12),dp(14),dp(12),dp(58));
      favoriteIcon=new PlaylistFavorite(c,activity.isPlaylistCollected(info));
      FrameLayout.LayoutParams favoriteParams=new FrameLayout.LayoutParams(dp(48),dp(48),Gravity.BOTTOM|Gravity.RIGHT);favoriteParams.rightMargin=dp(8);favoriteParams.bottomMargin=dp(6);hero.addView(favoriteIcon,favoriteParams);
      GlassUi.touch(favoriteIcon,()->activity.togglePlaylistFavorite(info));
    }

    LinearLayout toolbar = new LinearLayout(c);
    toolbar.setGravity(Gravity.CENTER_VERTICAL);
    toolbar.setPadding(0, dp(12), 0, dp(12));
    LinearLayout play = new LinearLayout(c);
    play.setGravity(Gravity.CENTER);
    play.setBackground(DotoDesign.cardSurface(c, 25));
    GlassUi.Symbol playIcon = new GlassUi.Symbol(c, "play", "播放全部", () -> actions.play(0, false));
    playIcon.color = DotoDesign.CARD_INK;
    play.addView(playIcon, new LayoutParams(dp(28), dp(44)));
    TextView playLabel = GlassUi.label(c, "播放全部", 14, true);
    playLabel.setTextColor(DotoDesign.CARD_INK);
    play.addView(playLabel);
    GlassUi.touch(
        play,
        () -> {
          if (songs.length() > 0) actions.play(0, false);
        });
    toolbar.addView(play, new LayoutParams(dp(136), dp(48)));
    toolbar.addView(new View(c),new LayoutParams(0,1,1));
    allButton=GlassUi.label(c,"全选",14,true);allButton.setGravity(Gravity.CENTER);allButton.setVisibility(GONE);toolbar.addView(allButton,new LayoutParams(dp(76),dp(48)));GlassUi.touch(allButton,()->{if(selection.size()==songs.length())selection.clear();else for(int i=0;i<songs.length();i++)selection.add(i);refreshSelection();});
    selectButton=GlassUi.label(c,"多选",14,true);selectButton.setGravity(Gravity.CENTER);toolbar.addView(selectButton,new LayoutParams(dp(64),dp(48)));GlassUi.touch(selectButton,()->{if(selecting)finishSelection();else{selecting=true;refreshSelection();showSelectionDrawer();}});
    addView(toolbar);
    if(searchResults){removeView(hero);removeView(toolbar);}
    rows = new ViewGroup(c) {
      private int columns;
      private int gap;

      @Override protected void onMeasure(int widthSpec, int heightSpec) {
        int width = MeasureSpec.getSize(widthSpec);
        columns = getResources().getConfiguration().orientation
                == android.content.res.Configuration.ORIENTATION_LANDSCAPE
            && width >= dp(560) ? 2 : 1;
        gap = columns == 2 ? dp(16) : 0;
        int height = 0;
        for (int i = 0; i < getChildCount(); i++) {
          View child = getChildAt(i);
          boolean row = child instanceof Row;
          int childWidth = row ? (width-gap)/columns : width;
          child.measure(MeasureSpec.makeMeasureSpec(childWidth, MeasureSpec.EXACTLY),
              row ? MeasureSpec.makeMeasureSpec(dp(66), MeasureSpec.EXACTLY)
                  : getChildMeasureSpec(heightSpec, 0, child.getLayoutParams().height));
          if (!row || i % columns == 0) height += child.getMeasuredHeight();
        }
        setMeasuredDimension(width, height);
      }

      @Override protected void onLayout(boolean changed, int l, int t, int r, int b) {
        int top = 0;
        for (int i = 0; i < getChildCount(); i++) {
          View child = getChildAt(i);
          boolean row = child instanceof Row;
          int left = row ? i % columns * (child.getMeasuredWidth()+gap) : 0;
          int bottom = top + child.getMeasuredHeight();
          child.layout(left, top, left+child.getMeasuredWidth(), bottom);
          if (!row || i % columns == columns-1 || i+1 == getChildCount()
              || !(getChildAt(i+1) instanceof Row)) top = bottom;
        }
      }
    };
    addView(rows, new LayoutParams(-1, -2));
    if (songs.length() == 0 && !info.optBoolean("loading",false)) {
      TextView empty = GlassUi.label(c, "暂无歌曲", 14, false);
      empty.setTextColor(GlassUi.MUTED);
      empty.setPadding(0, dp(24), 0, dp(24));
      rows.addView(empty, new LayoutParams(-1,-2));
      play.setEnabled(false);
      play.setAlpha(.4f);
    } else appendRows();
  }

  private static String summary(JSONObject info, JSONArray songs) {
    int total = info.optInt("trackCount", songs.length());
    if (total > songs.length()) return "已加载 " + songs.length() + " / " + total + " 首";
    long ms = 0;
    boolean known = songs.length() > 0;
    for (int i = 0; i < songs.length(); i++) {
      JSONObject song = songs.optJSONObject(i);
      long length = song.optLong("dt", song.optLong("duration", 0));
      ms += length;
      if (length <= 0) known = false;
    }
    String text = songs.length() + " 首";
    if (known) {
      long minutes = ms / 60000;
      text += " · " + (minutes >= 60 ? minutes / 60 + " 小时 " : "") + minutes % 60 + " 分钟";
    }
    return text;
  }

  static String artUrl(JSONObject song) {
    if (song == null) return "";
    JSONObject album = song.optJSONObject("al");
    if (album == null) album = song.optJSONObject("album");
    return album == null ? song.optString("picUrl") : album.optString("picUrl");
  }

  private void appendRows() {
    if (moreRows != null) {
      rows.removeView(moreRows);
      moreRows = null;
    }
    int end = Math.min(songs.length(), rendered.size() + 50);
    for (int i = rendered.size(); i < end; i++) {
      JSONObject song = songs.optJSONObject(i);
      if (song == null) song = new JSONObject();
      Row row = new Row(i, song);
      rendered.add(row);
      rows.addView(row, new LayoutParams(-1, dp(66)));
    }
    if (end < songs.length()) {
      moreRows =
          GlassUi.label(getContext(), "显示更多 · " + end + " / " + songs.length() + " 首", 13, false);
      moreRows.setGravity(Gravity.CENTER);
      moreRows.setTextColor(GlassUi.MUTED);
      rows.addView(moreRows, new LayoutParams(-1, dp(48)));
      GlassUi.touch(moreRows, this::appendRows);
    }
    updateCurrent(currentId, playing);refreshSelection();
  }

  void refreshViewport() {
    rows.requestLayout();
  }

  void updateCurrent(String id, boolean playing) {
    this.currentId = id;
    this.playing = playing;
    for (Row row : rendered) {
      boolean selected = !id.isEmpty() && id.equals(row.song.optString("id"));
      row.setBackground(selected ? GlassUi.glass(getContext(), 12) : null);
      row.bars.state(selected,playing);
      row.number.invalidate();
      row.title.setTextColor(selected ? DotoDesign.INK : GlassUi.INK);
      row.number.setContentDescription("第 " + (row.index + 1) + " 首");
    }
  }

  void showOptions() {
    if(searchResults)return;
    new DotoDesign.DialogBuilder(getContext())
        .setTitle("歌单操作")
        .setItems(
            new String[] {"播放全部", "随机播放", "选择下载歌曲"},
            (dialog, n) -> {
              if (songs.length() == 0) return;
              if (n == 2) chooseDownloads();
              else actions.play(n == 1 ? new Random().nextInt(songs.length()) : 0, n == 1);
            })
        .show();
  }

  private void chooseDownloads() {
    if (songs.length() == 0) return;
    String[] labels = new String[songs.length()];
    boolean[] checked = new boolean[labels.length];
    for (int i = 0; i < labels.length; i++) labels[i] = songs.optJSONObject(i).optString("name");
    new DotoDesign.DialogBuilder(getContext())
        .setTitle("选择下载歌曲")
        .setMultiChoiceItems(labels, checked, (dialog, index, value) -> checked[index] = value)
        .setNegativeButton("取消", null)
        .setPositiveButton(
            "下载已选",
            (dialog, which) -> {
              int count = 0;
              for (boolean value : checked) if (value) count++;
              int[] indices = new int[count];
              for (int i = 0, j = 0; i < checked.length; i++) if (checked[i]) indices[j++] = i;
              if (indices.length > 0) actions.download(indices);
            })
        .show();
  }

  private final class Index extends View {
    private final android.graphics.Paint paint=new android.graphics.Paint(3);
    private final int value;
    Index(Context c,int value){super(c);this.value=value;}
    protected void onDraw(android.graphics.Canvas canvas){float x=getWidth()/2f,y=getHeight()/2f;paint.setColor(GlassUi.MUTED);paint.setTextSize((value<100?11:9)*getResources().getDisplayMetrics().scaledDensity);paint.setTextAlign(android.graphics.Paint.Align.CENTER);android.graphics.Paint.FontMetrics metrics=paint.getFontMetrics();canvas.drawText(String.valueOf(value),x,y-(metrics.ascent+metrics.descent)/2,paint);}
  }

  private final class Row extends LinearLayout {
    final int index;
    final JSONObject song;
    final Index number;
    final NowPlayingBars bars;
    final TextView title;
    final TextView check;
    final View more;

    Row(int index, JSONObject song) {
      super(SongListPanel.this.getContext());
      this.index = index;
      this.song = song;
      Context c = getContext();
      setGravity(Gravity.CENTER_VERTICAL);
      check=GlassUi.label(c,"○",20,true);check.setGravity(Gravity.CENTER);check.setVisibility(GONE);addView(check,new LayoutParams(dp(32),dp(48)));GlassUi.touch(check,()->toggleSelection(index));
      number = new Index(c, index + 1);
      if(!searchResults)addView(number, new LayoutParams(dp(28), dp(48)));
      FrameLayout coverFrame=new FrameLayout(c);GlassUi.rounded(coverFrame,9);
      ImageView cover=GlassUi.art(c,9);images.into(cover,artUrl(song));coverFrame.addView(cover,new FrameLayout.LayoutParams(-1,-1));
      bars=new NowPlayingBars(c);coverFrame.addView(bars,new FrameLayout.LayoutParams(-1,-1));
      addView(coverFrame,new LayoutParams(dp(48),dp(48)));
      LinearLayout words = MobileUi.column(c);
      words.setPadding(dp(10), 0, dp(4), 0);
      title = GlassUi.label(c, song.optString("name"), 14, true);
      title.setSingleLine();
      title.setEllipsize(android.text.TextUtils.TruncateAt.END);
      words.addView(title);
      JSONArray artists = song.optJSONArray("ar");
      if (artists == null) artists = song.optJSONArray("artists");
      StringJoiner names = new StringJoiner(" / ");
      if (artists != null)
        for (int i = 0; i < artists.length(); i++)
          names.add(artists.optJSONObject(i).optString("name"));
      JSONObject album = song.optJSONObject("al");
      if (album == null) album = song.optJSONObject("album");
      String sub = names.toString();
      if (album != null && !album.optString("name").isEmpty())
        sub += (sub.isEmpty() ? "" : " · ") + album.optString("name");
      TextView detail = GlassUi.label(c, sub, 12, false);
      detail.setTextColor(GlassUi.MUTED);
      detail.setSingleLine();
      detail.setEllipsize(android.text.TextUtils.TruncateAt.END);
      LayoutParams lp = new LayoutParams(-1, dp(21));
      lp.topMargin = dp(3);
      words.addView(detail, lp);
      addView(words, new LayoutParams(0, -2, 1));
      String id = song.optString("id"),
          state = stems.contains(id) ? "已分轨" : downloaded.contains(id) ? "已下载" : "";
      if (!state.isEmpty()) {
        TextView badge = GlassUi.label(c, state, 11, false);
        badge.setTextColor(DotoDesign.MUTED);
        badge.setPadding(dp(5), dp(3), dp(5), dp(3));
        badge.setBackground(GlassUi.glass(c, 10));
        addView(badge, new LayoutParams(-2, -2));
      }
      Runnable play = () -> {if(selecting)toggleSelection(index);else actions.play(index,false);};
      GlassUi.touch(this,play);
      GlassUi.touch(number, play);
      GlassUi.touch(coverFrame, play);
      GlassUi.touch(cover, play);
      GlassUi.touch(words, play);
      more=new GlassUi.Symbol(c,"moreVertical","歌曲操作",()->{if(c instanceof MusicActivity activity)activity.songActions(song,sourceInfo);});addView(more,new LayoutParams(dp(48),dp(48)));
    }
  }
}
