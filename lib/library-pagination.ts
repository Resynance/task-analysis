export const LIBRARY_DEFAULT_PAGE_SIZE = 50;
export const LIBRARY_MAX_PAGE_SIZE = 100;

export function parseLibraryPaginationParams(
  sp: Record<string, string | string[] | undefined>,
): { page: number; perPage: number } {
  const pageRaw = typeof sp.page === "string" ? Number.parseInt(sp.page, 10) : NaN;
  const perRaw =
    typeof sp.perPage === "string" ? Number.parseInt(sp.perPage, 10) : NaN;
  const page =
    Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1;
  let perPage =
    Number.isFinite(perRaw) && perRaw >= 1
      ? Math.floor(perRaw)
      : LIBRARY_DEFAULT_PAGE_SIZE;
  perPage = Math.min(perPage, LIBRARY_MAX_PAGE_SIZE);
  return { page, perPage };
}
