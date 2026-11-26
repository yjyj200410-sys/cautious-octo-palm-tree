package com.volo.mobile;

import android.graphics.*;
import android.graphics.drawable.Drawable;

/** One 24-unit geometry and stroke system, shared by controls, menus and lists. */
final class DotoIcon extends Drawable {
  private final String kind;
  private final Paint ink=new Paint(3);
  private final Path path=new Path();
  private int color;
  private boolean enabled=true;
  DotoIcon(String kind,int color){this.kind=kind;this.color=color;}
  static String forLabel(String label){
    if ("头像".equals(label)) return "profile-portrait";
    if ("卡片背景".equals(label)) return "profile-landscape";
    if(label.contains("完成")||label.contains("确定"))return "check";
    if(label.contains("下一首"))return "queue-next";
    if(label.contains("返回")||label.contains("音乐库"))return "back";
    if(label.contains("退出"))return "logout";
    if(label.contains("切换账号"))return "switch";
    if(label.contains("添加")||label.contains("加入"))return "add";
    if(label.contains("登录")||label.contains("账号"))return "person";
    if(label.contains("刷新")||label.contains("重新")||label.contains("换一批"))return "refresh";
    if(label.contains("下载"))return "download";
    if(label.contains("导出")||label.contains("保存"))return "export";
    if(label.contains("取消")||label.contains("关闭"))return "close";
    if(label.contains("搜索"))return "search";
    if(label.contains("随机"))return "shuffle";
    if(label.contains("循环")||label.contains("播放模式"))return "repeat";
    if(label.contains("人声")||label.contains("分轨"))return "vocals";
    if(label.contains("伴奏"))return "music";
    if(label.contains("播放")||label.contains("试听"))return "play";
    if(label.contains("本地")||label.contains("导入")||label.contains("选择音乐"))return "folder";
    if(label.contains("喜欢")||label.contains("收藏"))return "heart";
    if(label.contains("设置"))return "settings";
    return "next";
  }
  private void line(Canvas c,float... p){path.reset();path.moveTo(p[0],p[1]);for(int i=2;i<p.length;i+=2)path.lineTo(p[i],p[i+1]);c.drawPath(path,ink);}
  public void draw(Canvas c){
    Rect b=getBounds();int save=c.save();float size=Math.min(b.width(),b.height());
    c.translate(b.centerX(),b.centerY());c.scale(size/24,size/24);
    ink.setColor(enabled?("moreVertical".equals(kind)?color:DotoAppearance.accent):DotoDesign.MUTED);ink.setStyle(Paint.Style.STROKE);ink.setStrokeWidth(1.8f);
    ink.setStrokeCap(Paint.Cap.ROUND);ink.setStrokeJoin(Paint.Join.ROUND);
    switch(kind){
      case "settings" -> {for(int i=0;i<3;i++){float x=-7+i*7,y=i==1?4:-3;line(c,x,-9,x,y-2);line(c,x,y+2,x,9);line(c,x-2,y,x+2,y);}}
      case "search" -> {c.drawCircle(-2,-2,6.5f,ink);line(c,3,3,9,9);}
      case "profile-portrait" -> {
        c.drawCircle(0, 0, 10, ink);
        c.drawCircle(0, -3.5f, 2.5f, ink);
        path.reset();
        path.moveTo(-5.5f, 5);
        path.cubicTo(-5.5f, -.5f, 5.5f, -.5f, 5.5f, 5);
        c.drawPath(path, ink);
      }
      case "profile-landscape" -> {
        c.drawRoundRect(-9, -9, 9, 9, 2, 2, ink);
        c.drawCircle(4, -3.5f, 1.7f, ink);
        line(c, -7, 5, -2.5f, -.5f, 1.5f, 4, 4, 1.5f, 7, 5);
      }
      case "person" -> {c.drawCircle(0,-4,3.8f,ink);path.reset();path.moveTo(-8,9);path.cubicTo(-8,-1,8,-1,8,9);c.drawPath(path,ink);}
      case "heart" -> {path.reset();path.moveTo(0,9);path.cubicTo(-3,6,-10,1,-10,-4);path.cubicTo(-10,-10,-3,-11,0,-5);path.cubicTo(3,-11,10,-10,10,-4);path.cubicTo(10,1,3,6,0,9);c.drawPath(path,ink);}
      case "download" -> {line(c,0,-9,0,4);line(c,-5,-1,0,4,5,-1);line(c,-9,4,-9,9,9,9,9,4);}
      case "export" -> {line(c,0,4,0,-9);line(c,-5,-4,0,-9,5,-4);line(c,-9,1,-9,9,9,9,9,1);}
      case "history" -> {c.drawArc(-9,-9,9,9,-135,315,false,ink);line(c,-10,-8,-10,-2,-4,-2);line(c,0,-5,0,1,4,3);}
      case "add" -> {line(c,-8,0,8,0);line(c,0,-8,0,8);}
      case "close" -> {line(c,-6,-6,6,6);line(c,6,-6,-6,6);}
      case "shuffle" -> {path.reset();path.moveTo(-10,-7);path.cubicTo(0,-7,0,7,10,7);path.moveTo(-10,7);path.cubicTo(-5,7,-4,4,-2,2);path.moveTo(2,-2);path.cubicTo(4,-5,5,-7,10,-7);c.drawPath(path,ink);line(c,6,-10,10,-7,6,-4);line(c,6,4,10,7,6,10);}
      case "repeat", "refresh" -> {path.reset();path.moveTo(-9,-1);path.cubicTo(-10,-10,4,-9,9,-7);path.moveTo(9,1);path.cubicTo(10,10,-4,9,-9,7);c.drawPath(path,ink);line(c,5,-11,9,-7,5,-3);line(c,-5,3,-9,7,-5,11);}
      case "vocals" -> {c.drawRoundRect(-3.5f,-10,3.5f,3,3.5f,3.5f,ink);c.drawArc(-7,-8,7,7,0,180,false,ink);line(c,0,7,0,11);line(c,-4,11,4,11);}
      case "music" -> {line(c,-3,6,-3,-7,8,-10,8,3);c.drawOval(-10,3,-3,9,ink);c.drawOval(1,0,8,6,ink);line(c,-3,-3,8,-6);}
      case "folder" -> {path.reset();path.moveTo(-10,-6);path.lineTo(-2,-6);path.lineTo(1,-3);path.lineTo(10,-3);path.lineTo(10,8);path.lineTo(-10,8);path.close();c.drawPath(path,ink);}
      case "switch" -> {line(c,-10,-4,9,-4,5,-8);line(c,10,4,-9,4,-5,8);}
      case "logout" -> {line(c,-1,-9,-9,-9,-9,9,-1,9);line(c,-2,0,10,0,5,-5);line(c,10,0,5,5);}
      case "check" -> line(c,-8,0,-2,6,9,-7);
      case "queue-next" -> {line(c,-9,-5,4,-5);line(c,-9,1,0,1);line(c,-9,7,0,7);line(c,5,0,10,5,5,10);}
      case "back" -> line(c,3,-7,-4,0,3,7);
      case "next" -> line(c,-3,-7,4,0,-3,7);
      case "moreVertical" -> {ink.setStyle(Paint.Style.FILL);for(int i=-1;i<=1;i++)c.drawCircle(0,i*6,1.6f,ink);}
      case "more" -> {ink.setStyle(Paint.Style.FILL);for(int i=-1;i<=1;i++)c.drawCircle(i*6,0,1.6f,ink);}
      case "discover" -> {path.reset();path.moveTo(0,-10);path.cubicTo(1,-2,2,-1,10,0);path.cubicTo(2,1,1,2,0,10);path.cubicTo(-1,2,-2,1,-10,0);path.cubicTo(-2,-1,-1,-2,0,-10);c.drawPath(path,ink);}
      case "pause" -> {ink.setStrokeWidth(3);line(c,-4,-8,-4,8);line(c,4,-8,4,8);}
      default -> {ink.setStyle(Paint.Style.FILL);path.reset();path.moveTo(-5,-8);path.cubicTo(-5,-9,-4,-9,-3,-8);path.lineTo(8,-1);path.quadTo(10,0,8,1);path.lineTo(-3,8);path.quadTo(-5,9,-5,7);path.close();c.drawPath(path,ink);}
    }
    c.restoreToCount(save);
  }
  @Override public boolean isStateful(){return true;}
  @Override protected boolean onStateChange(int[] states){enabled=false;for(int state:states)if(state==android.R.attr.state_enabled)enabled=true;invalidateSelf();return true;}
  public void setAlpha(int alpha){ink.setAlpha(alpha);}
  public void setColorFilter(ColorFilter filter){ink.setColorFilter(filter);}
  public int getOpacity(){return PixelFormat.TRANSLUCENT;}
}
