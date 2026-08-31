<?php
// api.php - NO whitespace before this line!

error_reporting(0);
ini_set('display_errors', 0);

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");

// ===== DATABASE CONFIGURATION =====
$host = 'localhost';
$db   = 'movies';
$user = 'root';
$pass = '';
$table = 'movies';
$charset = 'utf8mb4';

// ===== POSTER PATH CONFIGURATION =====
$posterBasePath = '../movies/antexport/';
$posterBaseUrl = '/movies/antexport/';
$noPosterFileName = 'movies_0000-coming_soon.jpg';
$paripakvaPosterBasePath = '../movies_template/paripakva/';
$paripakvaPosterBaseUrl = '/movies_template/paripakva/';
// ====================================

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";

$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed']);
    exit;
}

// ===== PAGINATION PARAMETERS =====
$query = isset($_GET['q']) ? trim($_GET['q']) : '';
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
$offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;

// Determine source table
$useParipakva = isset($_GET['archive']) && $_GET['archive'] == 1;
$tableToQuery = $useParipakva ? 'paripakva' : $table;

// Cap limit to prevent abuse
$limit = min($limit, 100);
if ($limit < 1) $limit = 50;
if ($offset < 0) $offset = 0;

// Build query with pagination
$sql = "SELECT 
            NUM, 
            FORMATTEDTITLE, 
            YEAR, 
            CATEGORY, 
            RATING, 
            USERRATING, 
            DESCRIPTION,
            CERTIFICATION,
            DIRECTOR, 
            ACTORS, 
            URL, 
            PICTURENAME, 
            LENGTH,
            COUNTRY,
            RESOLUTION,
            AUDIOFORMAT,
            FILESIZE,
            FILEPATH
        FROM $tableToQuery
        WHERE FORMATTEDTITLE LIKE :search1 
        OR CATEGORY LIKE :search2 
        ORDER BY NUM ASC 
        LIMIT :limit OFFSET :offset";

try {
    $stmt = $pdo->prepare($sql);
    $searchTerm = "%$query%";
    
    $stmt->bindValue(':search1', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':search2', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    
    $stmt->execute();
    $rows = $stmt->fetchAll();
    
    // ===== FIXED PAGINATION LOGIC =====
    // If we got fewer results than requested, we've reached the end
    // If we got exactly the limit, there MIGHT be more (check next batch)
    $returnedCount = count($rows);
    $hasMore = ($returnedCount === $limit);
    
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed']);
    exit;
}

// ===== GET TOTAL MATCHING RESULTS =====
try {
    $countStmt = $pdo->prepare("SELECT COUNT(*) as total FROM $table WHERE FORMATTEDTITLE LIKE :search1 OR CATEGORY LIKE :search2");
    $countStmt->bindValue(':search1', $searchTerm, PDO::PARAM_STR);
    $countStmt->bindValue(':search2', $searchTerm, PDO::PARAM_STR);
    $countStmt->execute();
    $totalResult = $countStmt->fetch();
    $totalMatches = $totalResult['total'] ?? 0;
} catch (\PDOException $e) {
    $totalMatches = 0; // fallback
}

// Map DB Columns to Frontend Model
$movies = array_map(function($row) use ($posterBaseUrl, $posterBasePath, $noPosterFileName, $useParipakva, $paripakvaPosterBasePath, $paripakvaPosterBaseUrl) {
    
    // ===== POSTER PATH LOGIC =====
    $posterValue = (!empty($row['PICTURENAME']) && trim($row['PICTURENAME']) !== '') 
        ? $row['PICTURENAME'] 
        : $noPosterFileName;
    
    // Choose paths based on source
    if ($useParipakva) {
        $posterPath = $paripakvaPosterBasePath;
        $posterUrl  = $paripakvaPosterBaseUrl;
    } else {
        $posterPath = $posterBasePath;
        $posterUrl  = $posterBaseUrl;
    }
    
    if (!empty($posterValue)) {
        $filename = basename($posterValue);
        $fullServerPath = $posterPath . $filename;
        
        if (file_exists($fullServerPath)) {
            $imageSrc = $posterUrl . $filename;
        } else {
            $imageSrc = $posterUrl . $noPosterFileName;
        }
    } else {
        $imageSrc = $posterUrl . $noPosterFileName;
    }
    // =============================

    $rating = !empty($row['USERRATING']) ? $row['USERRATING'] : $row['RATING'];
    
    // ===== EXTERNAL URL LOGIC =====
    $externalUrl = null;
    if (!empty($row['URL']) && filter_var(trim($row['URL']), FILTER_VALIDATE_URL)) {
        $externalUrl = trim($row['URL']);
    }
    // ==============================

    return [
        'id' => $row['NUM'],
        'num' => $row['NUM'],  // ← Explicit NUM field for frontend
        'title' => $row['FORMATTEDTITLE'],
        'year' => $row['YEAR'] ?? 'N/A',
        'genre' => $row['CATEGORY'] ?? 'Unknown',
        'rating' => $rating ?? '0',
        'poster' => $imageSrc,
        'description' => $row['DESCRIPTION'] ?? '',
        'certification' => $row['CERTIFICATION'] ?? '',
        'director' => $row['DIRECTOR'] ?? '',
        'actors' => $row['ACTORS'] ?? '',
        'length' => $row['LENGTH'] ?? '',
        'country' => $row['COUNTRY'] ?? '',
        'size' => $row['FILESIZE'] ?? '',
        'resolution' => $row['RESOLUTION'] ?? '',
        'audio' => $row['AUDIOFORMAT'] ?? '',
        'filepath' => $row['FILEPATH'] ?? '',
        'external_url' => $externalUrl,
        'source' => $useParipakva ? 'paripakva' : 'movies'
    ];
}, $rows);

// Return paginated response
echo json_encode([
    'movies' => $movies,
    'hasMore' => $hasMore,
    'nextOffset' => $offset + count($movies),
    'count' => count($movies),
    'limit' => $limit,
    'offset' => $offset,
    'totalMatches' => $totalMatches
]);