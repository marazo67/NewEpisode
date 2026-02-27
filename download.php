<?php
// download.php - Force download and track earnings
$file = $_GET['file'] ?? '';
if (!$file || strpos($file, 'uploads/') !== 0) {
    die('Invalid file');
}
$path = __DIR__ . '/' . $file;
if (!file_exists($path)) {
    die('File not found');
}

header('Content-Description: File Transfer');
header('Content-Type: application/octet-stream');
header('Content-Disposition: attachment; filename="' . basename($path) . '"');
header('Expires: 0');
header('Cache-Control: must-revalidate');
header('Pragma: public');
header('Content-Length: ' . filesize($path));
readfile($path);
exit;