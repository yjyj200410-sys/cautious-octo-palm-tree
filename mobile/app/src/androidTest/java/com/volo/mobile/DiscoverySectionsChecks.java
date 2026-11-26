package com.volo.mobile;
import org.json.*;
/** Runs on-device or on the JVM with the reference org.json implementation. */
final class DiscoverySectionsChecks {
  static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
  public static void main(String[] args)throws Exception{System.out.println(run());}
  static String run()throws Exception{
    JSONObject song=new JSONObject().put("id",101).put("name","Song");
    JSONObject songResource=new JSONObject().put("resourceExtInfo",new JSONObject().put("songData",song));
    JSONObject listResource=new JSONObject().put("resourceType","list").put("resourceId","202").put("uiElement",new JSONObject().put("mainTitle",new JSONObject().put("title","Radar")).put("image",new JSONObject().put("imageUrl","https://example.test/cover.jpg")));
    JSONArray resources=new JSONArray().put(songResource).put(songResource).put(listResource).put(listResource).put(new JSONObject().put("resourceType","video").put("resourceId",404));
    JSONObject block=new JSONObject().put("blockCode","HOMEPAGE_BLOCK_RADAR").put("uiElement",new JSONObject().put("mainTitle",new JSONObject().put("title","")).put("subTitle",new JSONObject().put("title","Radar section"))).put("creatives",new JSONArray().put(new JSONObject().put("resources",resources)));
    JSONObject ad=new JSONObject(block.toString()).put("blockCode","HOMEPAGE_BLOCK_ADVERTISE");
    JSONObject page=new JSONObject().put("data",new JSONObject().put("blocks",new JSONArray().put(block).put(ad).put(new JSONObject())));
    JSONArray sections=DiscoverySections.parse(page);require(sections.length()==2,"typed song and playlist sections, skip ads/unknown");
    require(sections.getJSONObject(0).getJSONArray("items").length()==1,"deduplicate songs");require(sections.getJSONObject(1).getJSONArray("items").length()==1,"deduplicate playlists");
    require(sections.getJSONObject(1).getJSONArray("items").getJSONObject(0).getString("coverImgUrl").endsWith("cover.jpg"),"preserve cover");require(sections.getJSONObject(0).getString("title").equals("Radar section"),"subtitle fallback");
    require(DiscoverySections.parse(new JSONObject()).length()==0,"missing blocks safe");
    JSONArray pool=new JSONArray();for(int i=1;i<=14;i++)pool.put(new JSONObject().put("id",i));
    JSONArray first=DiscoverySections.batch(pool,0,6),next=DiscoverySections.batch(pool,6,6);require(first.length()==6&&next.getJSONObject(0).getInt("id")==7,"next batch differs");require(DiscoverySections.batch(pool,12,6).length()==2,"partial final batch");require(DiscoverySections.batch(pool,18,6).length()==0,"end of pool");
    JSONArray distinct=DiscoverySections.excluding(pool,first);require(distinct.length()==8&&distinct.getJSONObject(0).getInt("id")==7,"exclude visible IDs from network results");require(DiscoverySections.excluding(first,first).length()==0,"same server response must not masquerade as refresh");
    require(DiscoverySections.radarPlaylists(sections).length()==1,"radar extraction by block code");
    require(DiscoverySections.radarPlaylists(new JSONArray().put(sections.getJSONObject(1)).put(sections.getJSONObject(1))).length()==1,"radar deduplication");
    JSONArray six=new JSONArray(),other=new JSONArray();for(int i=1;i<=6;i++){six.put(new JSONObject().put("id",i));other.put(new JSONObject().put("id",i+6));}
    JSONObject curated=new JSONObject().put("code","HOMEPAGE_BLOCK_STYLE_RCMD").put("kind","songs").put("items",six),second=new JSONObject(curated.toString()).put("items",other);
    JSONArray merged=DiscoverySections.mergeCurated(new JSONArray().put(curated),new JSONArray().put(second));require(DiscoverySections.curatedCount(merged)==12,"merge two six-song batches");require(DiscoverySections.curatedCount(DiscoverySections.mergeCurated(merged,new JSONArray().put(second)))==12,"dedupe and cap at twelve");
    JSONArray same=DiscoverySections.mergeCurated(new JSONArray().put(new JSONObject(curated.toString()).put("items",six)),new JSONArray().put(new JSONObject(curated.toString()).put("items",six)));require(DiscoverySections.curatedCount(same)==6,"identical response remains six");
    return "PASS: 16 discovery parsing and playlist batch checks";
  }
}
