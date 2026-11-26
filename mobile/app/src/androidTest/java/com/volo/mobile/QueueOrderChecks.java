package com.volo.mobile;
import java.util.*;
final class QueueOrderChecks {
  static void require(boolean ok,String message){if(!ok)throw new AssertionError(message);}
  static void check(){
    PlaybackOrder order=new PlaybackOrder(new Random(8));order.setShuffle(true);int[] before=order.queueOrder(6,3);ArrayList<Integer> expected=new ArrayList<>();for(int i:before)expected.add(i);int moved=expected.remove(4);expected.add(1,moved);order.moveDisplayed(6,3,4,1);int[] after=order.queueOrder(6,3);for(int i=0;i<6;i++)require(after[i]==expected.get(i),"displayed shuffle order");require(order.peek(6,3,1)==expected.get((expected.indexOf(3)+1)%6),"next follows reordered display");require(new HashSet<>(expected).size()==6,"no duplicate or missing tracks");order.moveDisplayed(6,3,-1,5);require(Arrays.equals(after,order.queueOrder(6,3)),"invalid move ignored");order.moveDisplayed(6,3,2,2);require(Arrays.equals(after,order.queueOrder(6,3)),"same-position move ignored");order.moveDisplayed(6,3,expected.indexOf(3),5);require(order.queueOrder(6,3)[5]==3,"moving current track preserves its identity");
  }
  public static void main(String[] args){check();System.out.println("PASS: shuffle reorder, traversal, identity and bounds checks");}
}
