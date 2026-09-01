<?php
// api.php - NO whitespace before this line!

error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");
header("Access-Control-Allow-Headers: Content-Type");

// ===== LOAD DATABASE CONFIGURATION =====
$config = require __DIR__ . '/config.php';

$host = $config['host'];
$db   = $config['db'];
$user = $config['user'];
$pass = $config['pass'];
$charset = $config['charset'];
$table = $config['table'];

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

// ===== HANDLE SPECIAL ACTIONS =====
$action = isset($_GET['action']) ? trim($_GET['action']) : '';

if ($action === 'categories') {
    $catTable = (isset($_GET['archive']) && $_GET['archive'] == 1) ? 'paripakva' : $table;
    $allowedCatTables = [$table, 'paripakva'];
    if (!in_array($catTable, $allowedCatTables, true)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid table']);
        exit;
    }
    try {
        $catStmt = $pdo->prepare("SELECT DISTINCT CATEGORY FROM $catTable WHERE CATEGORY IS NOT NULL AND CATEGORY != '' ORDER BY CATEGORY ASC");
        $catStmt->execute();
        $categories = array_column($catStmt->fetchAll(), 'CATEGORY');
        echo json_encode(['categories' => $categories]);
    } catch (\PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to fetch categories']);
    }
    exit;
}

if ($action === 'stats') {
    $statsTable = (isset($_GET['archive']) && $_GET['archive'] == 1) ? 'paripakva' : $table;
    $allowedStatsTables = [$table, 'paripakva'];
    if (!in_array($statsTable, $allowedStatsTables, true)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid table']);
        exit;
    }
    try {
        // Total movies
        $totalStmt = $pdo->prepare("SELECT COUNT(*) as total FROM $statsTable");
        $totalStmt->execute();
        $totalMovies = $totalStmt->fetch()['total'] ?? 0;

        // Average rating
        $avgStmt = $pdo->prepare("SELECT AVG(COALESCE(NULLIF(USERRATING, ''), RATING)) as avg_rating FROM $statsTable WHERE COALESCE(NULLIF(USERRATING, ''), RATING) IS NOT NULL AND COALESCE(NULLIF(USERRATING, ''), RATING) > 0");
        $avgStmt->execute();
        $avgRating = round($avgStmt->fetch()['avg_rating'] ?? 0, 1);

        // Most common genre
        $genreStmt = $pdo->prepare("SELECT CATEGORY, COUNT(*) as cnt FROM $statsTable WHERE CATEGORY IS NOT NULL AND CATEGORY != '' GROUP BY CATEGORY ORDER BY cnt DESC LIMIT 1");
        $genreStmt->execute();
        $topGenreRow = $genreStmt->fetch();
        $topGenre = $topGenreRow ? $topGenreRow['CATEGORY'] : 'N/A';
        $topGenreCount = $topGenreRow ? $topGenreRow['cnt'] : 0;

        echo json_encode([
            'totalMovies' => (int)$totalMovies,
            'avgRating' => $avgRating,
            'topGenre' => $topGenre,
            'topGenreCount' => (int)$topGenreCount
        ]);
    } catch (\PDOException $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Failed to fetch stats']);
    }
    exit;
}

// ===== PAGINATION PARAMETERS =====
$query = isset($_GET['q']) ? trim($_GET['q']) : '';
$limit = isset($_GET['limit']) ? (int)$_GET['limit'] : 50;
$offset = isset($_GET['offset']) ? (int)$_GET['offset'] : 0;
$category = isset($_GET['category']) ? trim($_GET['category']) : '';
$favsParam = isset($_GET['favs']) ? trim($_GET['favs']) : '';

// Determine source table (whitelist allowed table names)
$useParipakva = isset($_GET['archive']) && $_GET['archive'] == 1;
$allowedTables = [$table, 'paripakva'];
$tableToQuery = $useParipakva ? 'paripakva' : $table;

// Validate table name is in whitelist
if (!in_array($tableToQuery, $allowedTables, true)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid table']);
    exit;
}

// Cap limit to prevent abuse
$limit = min($limit, 100);
if ($limit < 1) $limit = 50;
if ($offset < 0) $offset = 0;

// Sanitize search query (strip null bytes, limit length)
$query = str_replace("\0", '', $query);
$query = mb_substr($query, 0, 200);

// ===== SORT PARAMETER =====
$sort = isset($_GET['sort']) ? trim($_GET['sort']) : 'num_asc';

$allowedSorts = [
    'num_asc'      => 'NUM ASC',
    'num_desc'     => 'NUM DESC',
    'title_asc'    => 'FORMATTEDTITLE ASC',
    'title_desc'   => 'FORMATTEDTITLE DESC',
    'year_asc'     => 'YEAR ASC',
    'year_desc'    => 'YEAR DESC',
    'rating_asc'   => 'COALESCE(NULLIF(USERRATING, \'\'), RATING) ASC',
    'rating_desc'  => 'COALESCE(NULLIF(USERRATING, \'\'), RATING) DESC',
];

if (!array_key_exists($sort, $allowedSorts)) {
    $sort = 'num_asc';
}

$orderBy = $allowedSorts[$sort];

// Build query with pagination — searches title, category, director, actors, year
$conditions = ["(FORMATTEDTITLE LIKE :search1 OR CATEGORY LIKE :search2 OR DIRECTOR LIKE :search3 OR ACTORS LIKE :search4 OR CAST(YEAR AS CHAR) LIKE :search5)"];
if ($category !== '') {
    $conditions[] = "CATEGORY = :category";
}

// Favorites filter: comma-separated NUM values
$favIds = [];
$favBindings = [];
if ($favsParam !== '') {
    $rawIds = explode(',', $favsParam);
    foreach ($rawIds as $i => $id) {
        $id = (int)trim($id);
        if ($id > 0) {
            $favIds[] = $id;
            $favBindings[":fav$i"] = $id;
        }
    }
    if (!empty($favIds)) {
        $placeholders = implode(',', array_keys($favBindings));
        $conditions[] = "NUM IN ($placeholders)";
    } else {
        // Empty favorites list — return nothing
        $conditions[] = "1 = 0";
    }
}

$whereClause = implode(' AND ', $conditions);

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
        WHERE $whereClause
        ORDER BY $orderBy 
        LIMIT :limit OFFSET :offset";

try {
    $stmt = $pdo->prepare($sql);
    $searchTerm = "%$query%";
    
    $stmt->bindValue(':search1', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':search2', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':search3', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':search4', $searchTerm, PDO::PARAM_STR);
    $stmt->bindValue(':search5', $searchTerm, PDO::PARAM_STR);
    if ($category !== '') {
        $stmt->bindValue(':category', $category, PDO::PARAM_STR);
    }
    foreach ($favBindings as $key => $val) {
        $stmt->bindValue($key, $val, PDO::PARAM_INT);
    }
    $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset, PDO::PARAM_INT);
    
    $stmt->execute();
    $rows = $stmt->fetchAll();
    
    $returnedCount = count($rows);
    $hasMore = ($returnedCount === $limit);
    
} catch (\PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Query failed']);
    exit;
}

// ===== GET TOTAL MATCHING RESULTS =====
try {
    $countStmt = $pdo->prepare("SELECT COUNT(*) as total FROM $tableToQuery WHERE $whereClause");
    $countStmt->bindValue(':search1', $searchTerm, PDO::PARAM_STR);
    $countStmt->bindValue(':search2', $searchTerm, PDO::PARAM_STR);
    $countStmt->bindValue(':search3', $searchTerm, PDO::PARAM_STR);
    $countStmt->bindValue(':search4', $searchTerm, PDO::PARAM_STR);
    $countStmt->bindValue(':search5', $searchTerm, PDO::PARAM_STR);
    if ($category !== '') {
        $countStmt->bindValue(':category', $category, PDO::PARAM_STR);
    }
    foreach ($favBindings as $key => $val) {
        $countStmt->bindValue($key, $val, PDO::PARAM_INT);
    }
    $countStmt->execute();
    $totalResult = $countStmt->fetch();
    $totalMatches = $totalResult['total'] ?? 0;
} catch (\PDOException $e) {
    $totalMatches = 0;
}

// Map DB Columns to Frontend Model
$movies = array_map(function($row) use ($posterBaseUrl, $posterBasePath, $noPosterFileName, $useParipakva, $paripakvaPosterBasePath, $paripakvaPosterBaseUrl) {
    
    $posterValue = (!empty($row['PICTURENAME']) && trim($row['PICTURENAME']) !== '') 
        ? $row['PICTURENAME'] 
        : $noPosterFileName;
    
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

    $rating = !empty($row['USERRATING']) ? $row['USERRATING'] : $row['RATING'];
    
    $externalUrl = null;
    if (!empty($row['URL']) && filter_var(trim($row['URL']), FILTER_VALIDATE_URL)) {
        $externalUrl = trim($row['URL']);
    }

    return [
        'id' => $row['NUM'],
        'num' => $row['NUM'],
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
    'totalMatches' => $totalMatches,
    'sort' => $sort
]);
