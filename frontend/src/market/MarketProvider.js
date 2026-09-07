import { useState } from "react";
import MarketContext from "./MarketContext";

export default function MarketProvider({ children }) {

  const [assets, setAssets] = useState([]);

  const value = {
    assets,
    setAssets,
  };

  return (
    <MarketContext.Provider value={value}>
      {children}
    </MarketContext.Provider>
  );
}