import api from "./api";

export const getImages = (page, limit, category = null, collection = null) => {
  return api.get("/images", {
    params: {
      page,
      limit,
      category: category || undefined,
      collection: collection || undefined,
      t: Date.now(),
    },
  });
};
export const likeImageRequest = (id) => {
  return api.put(`/images/${id}/like`);
};
export const addFavoriteRequest = (id, token) => {
  return api.post(
    `/favorites/${id}`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};
export const downloadImageRequest = (
  id,
  token
) => {
  return api.put(
    `/images/${id}/download`,
    {},
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
};
export const viewImageRequest = (id) => {
  return api.put(`/images/${id}/view`);
};