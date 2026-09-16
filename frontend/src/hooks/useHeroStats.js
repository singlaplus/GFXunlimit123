import { useEffect, useState } from "react";
import axios from "axios";

export default function useHeroStats() {

  const [heroStats, setHeroStats] =
    useState({

      totalAssets:0,

      totalSearches:0,

      totalDownloads:0,

      todayVisitors:0,

    });

  useEffect(() => {

    fetchHeroStats();

  }, []);

  async function fetchHeroStats(){

    try{

      const res =
      await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/hero-stats`
      );

      const stats = res?.data || {};

      setHeroStats({
        totalAssets: Number(stats.totalAssets) || 0,
        totalSearches: Number(stats.totalSearches) || 0,
        totalDownloads: Number(stats.totalDownloads) || 0,
        todayVisitors: Number(stats.todayVisitors) || 0,
      });

    }

    catch(err){

      console.log(err);

    }

  }

  return heroStats;

}