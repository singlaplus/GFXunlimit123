import { useContext } from "react";
import MarketContext from "./MarketContext";

export default function useMarket() {
  return useContext(MarketContext);
}