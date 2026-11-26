package com.volo.mobile;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.*;
import android.widget.*;
import java.util.*;

/** Text-only live queue with removal and native long-press drag sorting. */
final class QueueSheet extends Dialog {
  interface Actions {void play(int index);void remove(int index);void move(int from,int to);}
  private final Activity activity;
  private final Actions actions;
  private final ArrayList<Integer> positions=new ArrayList<>();
  private String[] titles=new String[0],artists=new String[0];
  private int current=-1,dragOriginal=-1,edge;
  private Object dragToken;
  private float dragY;
  private final ListView list;
  private final TextView heading,empty;
  private final BaseAdapter adapter;
  private final Handler handler=new Handler(Looper.getMainLooper());
  private int dp(float value){return MobileUi.dp(activity,value);}
  private final Runnable edgeScroll=new Runnable(){public void run(){if(dragToken==null||edge==0)return;list.smoothScrollBy(edge*dp(18),60);previewAt(dragY);handler.postDelayed(this,60);}};

  QueueSheet(Activity activity,Actions actions){
    super(activity);this.activity=activity;this.actions=actions;
    LinearLayout panel=MobileUi.column(activity);panel.setPadding(dp(16),dp(12),dp(16),dp(12));panel.setBackground(DotoDesign.cardSurface(activity,26));
    LinearLayout top=new LinearLayout(activity);top.setGravity(Gravity.CENTER_VERTICAL);heading=GlassUi.label(activity,"播放队列",20,true);heading.setTextColor(DotoDesign.CARD_INK);top.addView(heading,new LinearLayout.LayoutParams(0,dp(48),1));GlassUi.Symbol close=new GlassUi.Symbol(activity,"close","关闭播放队列",this::dismiss);top.addView(close,new LinearLayout.LayoutParams(dp(48),dp(48)));panel.addView(top);
    TextView help=GlassUi.label(activity,"长按歌曲可调整顺序",12,false);help.setTextColor(DotoDesign.CARD_MUTED);panel.addView(help,new LinearLayout.LayoutParams(-1,dp(28)));
    list=new ListView(activity);list.setDivider(null);list.setVerticalScrollBarEnabled(false);list.setCacheColorHint(Color.TRANSPARENT);list.setSelector(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT));
    adapter=new BaseAdapter(){public int getCount(){return positions.size();}public Object getItem(int position){return titles[positions.get(position)];}public long getItemId(int position){return positions.get(position);}public View getView(int position,View recycled,android.view.ViewGroup parent){QueueRow row=recycled instanceof QueueRow?(QueueRow)recycled:new QueueRow();row.bind(positions.get(position));return row;}};
    list.setAdapter(adapter);panel.addView(list,new LinearLayout.LayoutParams(-1,0,1));empty=GlassUi.label(activity,"播放队列为空",15,false);empty.setTextColor(DotoDesign.CARD_MUTED);empty.setGravity(Gravity.CENTER);panel.addView(empty,new LinearLayout.LayoutParams(-1,dp(100)));empty.setVisibility(View.GONE);
    list.setOnDragListener((view,event)->{
      if(event.getAction()==DragEvent.ACTION_DRAG_STARTED)return dragToken!=null&&event.getLocalState()==dragToken;
      if(dragToken==null||event.getLocalState()!=dragToken)return false;
      if(event.getAction()==DragEvent.ACTION_DRAG_LOCATION){dragY=event.getY();previewAt(dragY);int next=dragY<dp(48)?-1:dragY>list.getHeight()-dp(48)?1:0;if(next!=edge){edge=next;handler.removeCallbacks(edgeScroll);if(edge!=0)handler.post(edgeScroll);}return true;}
      if(event.getAction()==DragEvent.ACTION_DROP){int from=dragOriginal,to=positions.indexOf(from);endDrag(true);if(to>=0&&from!=to)actions.move(from,to);return true;}
      if(event.getAction()==DragEvent.ACTION_DRAG_ENDED){endDrag(true);return true;}return true;
    });
    setContentView(panel);Window window=getWindow();window.setBackgroundDrawableResource(android.R.color.transparent);window.addFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);window.setDimAmount(.38f);window.setGravity(Gravity.BOTTOM);
    panel.setOnApplyWindowInsetsListener((view,insets)->{int bottom=insets.getInsets(WindowInsets.Type.systemBars()).bottom;panel.setPadding(dp(16),dp(12),dp(16),dp(12)+bottom);return insets;});
  }
  void state(String[] titles,String[] artists,int current){
    boolean changed=!Arrays.equals(this.titles,titles)||!Arrays.equals(this.artists,artists);
    if(changed){endDrag(true);this.titles=titles.clone();this.artists=artists.clone();resetPositions();}
    this.current=current;heading.setText("播放队列 · "+titles.length);empty.setVisibility(titles.length==0?View.VISIBLE:View.GONE);list.setVisibility(titles.length==0?View.GONE:View.VISIBLE);adapter.notifyDataSetChanged();
  }
  private void resetPositions(){positions.clear();for(int i=0;i<titles.length;i++)positions.add(i);}
  private void previewAt(float y){int to=list.pointToPosition(dp(24),Math.max(0,Math.min(list.getHeight()-1,(int)y)));int from=positions.indexOf(dragOriginal);if(to>=0&&from>=0&&to!=from){positions.add(to,positions.remove(from));adapter.notifyDataSetChanged();}}
  private void endDrag(boolean restore){handler.removeCallbacks(edgeScroll);dragToken=null;dragOriginal=-1;edge=0;if(restore)resetPositions();if(adapter!=null)adapter.notifyDataSetChanged();}
  @Override protected void onStart(){super.onStart();getWindow().setLayout(-1,Math.min(dp(560),(int)(activity.getWindowManager().getCurrentWindowMetrics().getBounds().height()*.68f)));if(current>=0)list.setSelection(Math.max(0,current-2));}
  @Override protected void onStop(){endDrag(true);super.onStop();}
  private final class QueueRow extends LinearLayout {
    int original;final TextView title,artist;final GlassUi.Symbol remove;
    QueueRow(){super(activity);setGravity(Gravity.CENTER_VERTICAL);setPadding(dp(12),dp(4),0,dp(4));setMinimumHeight(dp(56));LinearLayout words=MobileUi.column(activity);title=GlassUi.label(activity,"",15,false);title.setSingleLine();title.setEllipsize(android.text.TextUtils.TruncateAt.END);words.addView(title);artist=GlassUi.label(activity,"",12,false);artist.setSingleLine();artist.setEllipsize(android.text.TextUtils.TruncateAt.END);LinearLayout.LayoutParams meta=new LinearLayout.LayoutParams(-1,dp(20));meta.topMargin=dp(2);words.addView(artist,meta);addView(words,new LinearLayout.LayoutParams(0,-2,1));remove=new GlassUi.Symbol(activity,"close","从播放队列移除",()->{if(dragToken==null)actions.remove(original);});addView(remove,new LinearLayout.LayoutParams(dp(44),dp(44)));setOnClickListener(view->{if(dragToken==null)actions.play(original);});setOnLongClickListener(view->{dragOriginal=original;dragToken=new Object();boolean started=startDragAndDrop(ClipData.newPlainText("queue-row",""),new View.DragShadowBuilder(this),dragToken,0);if(!started)endDrag(true);else adapter.notifyDataSetChanged();return started;});}
    void bind(int index){original=index;boolean active=index==current;title.setText(titles[index]);title.setTypeface(android.graphics.Typeface.create(active?"sans-serif-medium":"sans-serif",android.graphics.Typeface.NORMAL));title.setTextColor(DotoDesign.CARD_INK);String singer=index<artists.length?artists[index]:"";artist.setText(active?"正在播放"+(singer.isEmpty()?"":" · "+singer):singer);artist.setTextColor(active?DotoDesign.CARD_INK:DotoDesign.CARD_MUTED);setSelected(active);setAlpha(index==dragOriginal?.45f:1);setBackground(active?DotoDesign.shape(activity,DotoAppearance.light?0xffc8c8c4:0xff414145,16):null);remove.setContentDescription("移除 "+titles[index]);}
  }
}
