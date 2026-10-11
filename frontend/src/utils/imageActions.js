import { API_BASE_URL } from "./apiBaseUrl.js";
import axios from "axios";

export const likeImageRequest = async (id) => {
  return await axios.put(
    `${API_BASE_URL}/images/${id}/like`
  );
};

export const downloadImageRequest = async (id) => {
  return await axios.put(
    `${API_BASE_URL}/images/${id}/download`
  );
};

export const viewImageRequest = async (id) => {
  return await axios.put(
    `${API_BASE_URL}/images/${id}/view`
  );
};