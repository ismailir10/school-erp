/**
 * sessionStorage key holding the students list's last `?q=&status=&page=`
 * query string. The list writes it; the detail page's "Kembali ke Daftar
 * Siswa" link reads it, so the explicit back link restores the list state the
 * same way the browser's Back button does.
 */
export const STUDENT_LIST_QUERY_KEY = "admin.students.listQuery";
