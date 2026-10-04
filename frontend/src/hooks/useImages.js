import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { getImages } from "../services/imageService";

const mergeImagesById = (currentImages, nextImages) => {
  const knownIds = new Set(currentImages.map((image) => String(image.id)));
  return [
    ...currentImages,
    ...nextImages.filter((image) => {
      const id = String(image.id);
      if (knownIds.has(id)) return false;
      knownIds.add(id);
      return true;
    }),
  ];
};

const sortAssetsByUploadDate = (assets) => assets.sort((a, b) => {
  const aDate = Date.parse(a.created_at);
  const bDate = Date.parse(b.created_at);
  const aHasDate = Number.isFinite(aDate);
  const bHasDate = Number.isFinite(bDate);

  if (aHasDate && bHasDate && aDate !== bDate) return bDate - aDate;
  if (aHasDate !== bHasDate) return aHasDate ? -1 : 1;
  return Number(b.id) - Number(a.id);
});

export default function useImages({
  currentPage,
  totalPages,
  setCurrentPage,
  imagesPerPage,
  images,
  setImages,
  setLoading,
  setTotalImages,
  setTotalLikes,
  setTotalDownloads,
  setTotalViews,
  setTotalPages,
  setSelectedImage,
  setRelatedImages,
  selectedCategory,
  selectedCollection,
  search = "",
  sortType = "newest",
  isExplorePage = false,
}) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const [loadedPage, setLoadedPage] = useState(0);
  const loadedPageQueryKeyRef = useRef(null);
  const requestSequenceRef = useRef(0);
  const requestControllerRef = useRef(null);
  const exploreCatalogCacheRef = useRef(null);
  const loadingMoreRef = useRef(false);
  const skipPageFetchRef = useRef(null);
  const previousExplorePageRef = useRef(false);
  const queryKey = JSON.stringify([
    imagesPerPage,
    selectedCategory,
    selectedCollection,
    search,
    sortType,
  ]);
  const currentQueryKeyRef = useRef(queryKey);
  currentQueryKeyRef.current = queryKey;
  const previousQueryKeyRef = useRef(queryKey);

  useEffect(() => () => {
    requestControllerRef.current?.abort();
  }, []);

  const requestPage = useCallback(async (page, append, signal, requestId, requestedQueryKey) => {
    const shouldSortExploreCatalog = isExplorePage && sortType === "newest";
    const cachedCatalog = exploreCatalogCacheRef.current;
    let imagesResult;
    let totalImagesResult;
    let totalLikesResult;
    let totalDownloadsResult;
    let totalViewsResult;

    if (shouldSortExploreCatalog && cachedCatalog?.queryKey === requestedQueryKey) {
      totalImagesResult = cachedCatalog.totalImages;
      totalLikesResult = cachedCatalog.totalLikes;
      totalDownloadsResult = cachedCatalog.totalDownloads;
      totalViewsResult = cachedCatalog.totalViews;
      imagesResult = cachedCatalog.images.slice(
        (page - 1) * imagesPerPage,
        page * imagesPerPage
      );
    } else {
      const requestLimit = shouldSortExploreCatalog ? 1000 : imagesPerPage;
      const response = await getImages(
        shouldSortExploreCatalog ? 1 : page,
        requestLimit,
        selectedCategory,
        selectedCollection,
        search,
        sortType,
        signal
      );

      if (
        signal.aborted ||
        requestId !== requestSequenceRef.current ||
        requestedQueryKey !== currentQueryKeyRef.current
      ) {
        return false;
      }

      const data = response?.data || {};
      totalImagesResult = Number(data.totalImages) || 0;
      totalLikesResult = Number(data.totalLikes) || 0;
      totalDownloadsResult = Number(data.totalDownloads) || 0;
      totalViewsResult = Number(data.totalViews) || 0;
      imagesResult = Array.isArray(data.images) ? [...data.images] : [];

      if (shouldSortExploreCatalog) {
        let catalogPage = 2;

        while (imagesResult.length < totalImagesResult) {
          const nextResponse = await getImages(
            catalogPage,
            requestLimit,
            selectedCategory,
            selectedCollection,
            search,
            sortType,
            signal
          );

          if (
            signal.aborted ||
            requestId !== requestSequenceRef.current ||
            requestedQueryKey !== currentQueryKeyRef.current
          ) {
            return false;
          }

          const nextPageImages = Array.isArray(nextResponse?.data?.images)
            ? nextResponse.data.images
            : [];
          if (nextPageImages.length === 0) {
            throw new Error(
              `Failed to load the complete Explore catalog: received ${imagesResult.length} of ${totalImagesResult} assets`
            );
          }

          imagesResult.push(...nextPageImages);
          catalogPage += 1;
        }

        sortAssetsByUploadDate(imagesResult);
        exploreCatalogCacheRef.current = {
          queryKey: requestedQueryKey,
          images: imagesResult,
          totalImages: totalImagesResult,
          totalLikes: totalLikesResult,
          totalDownloads: totalDownloadsResult,
          totalViews: totalViewsResult,
        };
        imagesResult = imagesResult.slice(
          (page - 1) * imagesPerPage,
          page * imagesPerPage
        );
      }
    }

    setImages((currentImages) => (
      append ? mergeImagesById(currentImages, imagesResult) : imagesResult
    ));
    setTotalImages(totalImagesResult);
    setTotalLikes(totalLikesResult);
    setTotalDownloads(totalDownloadsResult);
    setTotalViews(totalViewsResult);
    setTotalPages(
      imagesPerPage > 0
        ? Math.ceil(totalImagesResult / imagesPerPage)
        : 0
    );
    setLoadedPage(page);
    loadedPageQueryKeyRef.current = isExplorePage ? requestedQueryKey : null;
    setLoadMoreError(false);

    if (append) {
      skipPageFetchRef.current = { page, queryKey: requestedQueryKey };
      setCurrentPage(page);
    }

    return true;
  }, [
    imagesPerPage,
    selectedCategory,
    selectedCollection,
    search,
    sortType,
    setImages,
    setTotalImages,
    setTotalLikes,
    setTotalDownloads,
    setTotalViews,
    setTotalPages,
    setCurrentPage,
    isExplorePage,
  ]);

  const fetchImages = useCallback(async () => {
    if (isExplorePage) {
      exploreCatalogCacheRef.current = null;
    }

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++requestSequenceRef.current;
    setLoading(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;

    try {
      await requestPage(currentPage, false, controller.signal, requestId, queryKey);
    } catch (error) {
      if (!controller.signal.aborted) {
        console.error("Failed to load images", error);
      }
    } finally {
      if (!controller.signal.aborted && requestId === requestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [currentPage, isExplorePage, queryKey, requestPage, setLoading]);

  useEffect(() => {
    const enteredExplorePage = isExplorePage && !previousExplorePageRef.current;
    previousExplorePageRef.current = isExplorePage;
    const queryChanged = previousQueryKeyRef.current !== queryKey;
    previousQueryKeyRef.current = queryKey;
    requestControllerRef.current?.abort();

    if (enteredExplorePage) {
      exploreCatalogCacheRef.current = null;
      skipPageFetchRef.current = null;
      loadingMoreRef.current = false;
      loadedPageQueryKeyRef.current = null;
      setLoadingMore(false);
      setLoadMoreError(false);
      setLoadedPage(0);
      setImages([]);
      setTotalImages(0);
      setTotalPages(1);

      if (currentPage !== 1) {
        setCurrentPage(1);
        return undefined;
      }
    }

    if (isExplorePage && queryChanged) {
      exploreCatalogCacheRef.current = null;
      skipPageFetchRef.current = null;
      loadingMoreRef.current = false;
      loadedPageQueryKeyRef.current = null;
      setLoadingMore(false);
      setLoadMoreError(false);
      setLoadedPage(0);
      setImages([]);
      setTotalImages(0);
      setTotalPages(1);

      if (currentPage !== 1) {
        setCurrentPage(1);
        return undefined;
      }
    }

    if (
      isExplorePage &&
      skipPageFetchRef.current?.page === currentPage &&
      skipPageFetchRef.current?.queryKey === queryKey
    ) {
      skipPageFetchRef.current = null;
      return undefined;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++requestSequenceRef.current;

    if (isExplorePage) {
      setImages([]);
      setLoadedPage(0);
      loadingMoreRef.current = false;
      setLoadingMore(false);
      setLoadMoreError(false);
    }
    setLoading(true);

    const debounceDelay = search.trim() ? 250 : 0;
    const fetchTimeout = window.setTimeout(async () => {
      try {
        await requestPage(currentPage, false, controller.signal, requestId, queryKey);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("Failed to load images", error);
        }
      } finally {
        if (!controller.signal.aborted && requestId === requestSequenceRef.current) {
          setLoading(false);
        }
      }
    }, debounceDelay);

    const refreshTimers = new Set();
    const handleAssetUpdate = () => {
      const timer = window.setTimeout(() => {
        refreshTimers.delete(timer);
        fetchImages();
      }, 250);
      refreshTimers.add(timer);
    };

    window.addEventListener("asset-updated", handleAssetUpdate);
    window.addEventListener("asset-refresh", handleAssetUpdate);
    window.addEventListener("asset-updated-detail", handleAssetUpdate);
    window.addEventListener("home-assets-refresh", handleAssetUpdate);

    return () => {
      window.clearTimeout(fetchTimeout);
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
      controller.abort();
      window.removeEventListener("asset-updated", handleAssetUpdate);
      window.removeEventListener("asset-refresh", handleAssetUpdate);
      window.removeEventListener("asset-updated-detail", handleAssetUpdate);
      window.removeEventListener("home-assets-refresh", handleAssetUpdate);
    };
  }, [
    currentPage,
    imagesPerPage,
    selectedCategory,
    selectedCollection,
    search,
    sortType,
    isExplorePage,
    queryKey,
    requestPage,
    fetchImages,
    setImages,
    setLoading,
    setTotalImages,
    setTotalPages,
    setCurrentPage,
  ]);

  const loadMoreImages = useCallback(async () => {
    if (
      !isExplorePage ||
      loadingMoreRef.current ||
      loadedPage === 0 ||
      loadedPageQueryKeyRef.current !== currentQueryKeyRef.current ||
      loadedPage >= totalPages
    ) {
      return;
    }

    const nextPage = loadedPage + 1;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const requestId = ++requestSequenceRef.current;
    const requestedQueryKey = currentQueryKeyRef.current;

    try {
      await requestPage(nextPage, true, controller.signal, requestId, requestedQueryKey);
    } catch (error) {
      if (!controller.signal.aborted && requestId === requestSequenceRef.current) {
        console.error("Failed to load the next image batch", error);
        setLoadMoreError(true);
      }
    } finally {
      if (!controller.signal.aborted && requestId === requestSequenceRef.current) {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }
  }, [isExplorePage, loadedPage, totalPages, requestPage]);

  const fetchSingleImage = async (id) => {
    try {
      await axios.put(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${id}/view`
      );

      const response = await axios.get(
        `${process.env.REACT_APP_API_BASE_URL || "http://localhost:5000"}/images/${id}`
      );

      setSelectedImage(response.data);

      const related = images
        .filter((image) => (
          image.id !== response.data.id &&
          image.category === response.data.category
        ))
        .slice(0, 4);

      setRelatedImages(related);
      setImages((previousImages) => previousImages.map((image) => (
        Number(image.id) === Number(id)
          ? { ...image, views: response.data.views }
          : image
      )));
    } catch (error) {
      console.error("Failed to load image details", error);
    }
  };

  return {
    fetchImages,
    fetchSingleImage,
    loadMoreImages,
    hasMore: isExplorePage && loadedPage > 0 && loadedPage < totalPages,
    loadingMore,
    loadMoreError,
  };
}
