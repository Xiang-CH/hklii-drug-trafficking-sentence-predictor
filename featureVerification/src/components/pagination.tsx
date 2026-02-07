import {
  Pagination as PaginationComponent,
  PaginationContent,
//   PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'

export function Pagination({
  currentPage,
  totalPages,
}: {
  currentPage: number
  totalPages: number
}) {
  return (
    <PaginationComponent>
      <PaginationContent>
        {currentPage > 1 && (
          <PaginationItem>
            <PaginationPrevious href={`/admin/users?page=${currentPage - 1}`} />
          </PaginationItem>
        )}
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <PaginationItem key={page}>
            <PaginationLink
              href={
                page === currentPage ? undefined : `/admin/users?page=${page}`
              }
              isActive={page === currentPage}
            >
              {page}
            </PaginationLink>
          </PaginationItem>
        ))}
        {currentPage < totalPages && (
          <PaginationItem>
            <PaginationNext href={`/admin/users?page=${currentPage + 1}`} />
          </PaginationItem>
        )}
      </PaginationContent>
    </PaginationComponent>
  )
}