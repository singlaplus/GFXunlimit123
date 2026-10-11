import { API_BASE_URL } from "../utils/apiBaseUrl.js";
import { useEffect, useState } from "react";
import axios from "axios";

export default function useTrendingKeywords() {

  const [trendingKeywords, setTrendingKeywords] = useState([]);

  async function fetchTrendingKeywords() {

    try {

      const res = await axios.get(
        `${API_BASE_URL}/trending-keywords`
      );

      const data = res?.data;
      setTrendingKeywords(Array.isArray(data) ? data : []);

    } catch (err) {

      console.log(err);

    }

  }

  useEffect(() => {

    fetchTrendingKeywords();

    const interval = setInterval(() => {

      fetchTrendingKeywords();

    }, 60000);

    return () => clearInterval(interval);

  }, []);

  return trendingKeywords;

}