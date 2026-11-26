package com.volo.mobile;

import org.json.*;
import java.util.*;

/** Typed adapters for homepage music resources; unknown/ad/podcast blocks are ignored. */
final class DiscoverySections {
  static String title(JSONObject ui){if(ui==null)return "";JSONObject main=ui.optJSONObject("mainTitle");if(main==null||main.optString("title").isEmpty())main=ui.optJSONObject("subTitle");return main==null?"":main.optString("title");}
  static String image(JSONObject ui){if(ui==null)return "";JSONObject image=ui.optJSONObject("image");return image==null?"":image.optString("imageUrl");}
  static JSONArray parse(JSONObject response)throws JSONException{
    JSONArray result=new JSONArray();JSONObject data=response.optJSONObject("data");JSONArray blocks=data==null?null:data.optJSONArray("blocks");
    for(int i=0;blocks!=null&&i<blocks.length();i++){
      JSONObject block=blocks.optJSONObject(i);if(block==null)continue;String code=block.optString("blockCode");
      if(code.contains("BANNER")||code.contains("ADVERTISE")||code.contains("PODCAST")||code.contains("VIDEO")||code.contains("MLOG"))continue;
      JSONArray creatives=block.optJSONArray("creatives"),songs=new JSONArray(),lists=new JSONArray();Set<String> songIds=new HashSet<>(),listIds=new HashSet<>();
      for(int j=0;creatives!=null&&j<creatives.length();j++){
        JSONObject creative=creatives.optJSONObject(j);if(creative==null)continue;JSONArray resources=creative.optJSONArray("resources");
        for(int k=0;resources!=null&&k<resources.length();k++){
          JSONObject resource=resources.optJSONObject(k);if(resource==null)continue;JSONObject ext=resource.optJSONObject("resourceExtInfo"),song=ext==null?null:ext.optJSONObject("songData");
          if(song!=null&&song.optLong("id")>0){if(songIds.add(song.optString("id")))songs.put(song);continue;}
          String type=resource.optString("resourceType").toLowerCase(Locale.ROOT);if(!type.equals("playlist")&&!type.equals("list"))continue;
          long id=resource.optLong("resourceId");JSONObject ui=resource.optJSONObject("uiElement");String name=title(ui);if(name.isEmpty())name=title(creative.optJSONObject("uiElement"));if(id<=0||name.isEmpty()||!listIds.add(Long.toString(id)))continue;
          String cover=image(ui);if(cover.isEmpty())cover=image(creative.optJSONObject("uiElement"));lists.put(new JSONObject().put("id",id).put("name",name).put("picUrl",cover).put("coverImgUrl",cover));
        }
      }
      String name=title(block.optJSONObject("uiElement"));if(name.isEmpty())continue;
      if(songs.length()>0)result.put(new JSONObject().put("title",name).put("code",code).put("kind","songs").put("items",songs));
      if(lists.length()>0)result.put(new JSONObject().put("title",name).put("code",code).put("kind","playlists").put("items",lists));
    }return result;
  }
  static JSONArray mergeCurated(JSONArray first,JSONArray next)throws JSONException{
    JSONObject target=null,source=null;
    for(int i=0;i<first.length();i++){JSONObject block=first.optJSONObject(i);if(block!=null&&"HOMEPAGE_BLOCK_STYLE_RCMD".equals(block.optString("code"))&&"songs".equals(block.optString("kind")))target=block;}
    for(int i=0;i<next.length();i++){JSONObject block=next.optJSONObject(i);if(block!=null&&"HOMEPAGE_BLOCK_STYLE_RCMD".equals(block.optString("code"))&&"songs".equals(block.optString("kind")))source=block;}
    if(source==null)return first;if(target==null){first.put(source);return first;}
    JSONArray combined=new JSONArray();Set<String> ids=new HashSet<>();for(JSONObject block:new JSONObject[]{target,source}){JSONArray items=block.optJSONArray("items");for(int i=0;items!=null&&i<items.length()&&combined.length()<12;i++){JSONObject song=items.optJSONObject(i);if(song!=null&&song.optLong("id")>0&&ids.add(song.optString("id")))combined.put(song);}}target.put("items",combined);return first;
  }
  static int curatedCount(JSONArray sections){for(int i=0;i<sections.length();i++){JSONObject block=sections.optJSONObject(i);if(block!=null&&"HOMEPAGE_BLOCK_STYLE_RCMD".equals(block.optString("code"))&&"songs".equals(block.optString("kind"))){JSONArray items=block.optJSONArray("items");return items==null?0:items.length();}}return 0;}
  static boolean radar(JSONObject section){return "playlists".equals(section.optString("kind"))&&(section.optString("title").contains("雷达")||section.optString("code").contains("MGC_PLAYLIST")||section.optString("code").contains("RADAR"));}
  static JSONArray radarPlaylists(JSONArray sections){JSONArray result=new JSONArray();Set<String> ids=new HashSet<>();for(int i=0;i<sections.length();i++){JSONObject section=sections.optJSONObject(i);if(section==null||!radar(section))continue;JSONArray items=section.optJSONArray("items");for(int j=0;items!=null&&j<items.length();j++){JSONObject item=items.optJSONObject(j);if(item!=null&&item.optLong("id")>0&&ids.add(item.optString("id")))result.put(item);}}return result;}
  static JSONArray batch(JSONArray pool,int offset,int size){JSONArray result=new JSONArray();for(int i=offset;i<Math.min(offset+size,pool.length());i++)result.put(pool.optJSONObject(i));return result;}
  static JSONArray excluding(JSONArray pool,JSONArray visible){Set<String> ids=new HashSet<>();for(int i=0;i<visible.length();i++)ids.add(visible.optJSONObject(i).optString("id"));JSONArray result=new JSONArray();for(int i=0;i<pool.length();i++){JSONObject item=pool.optJSONObject(i);if(item!=null&&item.optLong("id")>0&&ids.add(item.optString("id")))result.put(item);}return result;}
}
