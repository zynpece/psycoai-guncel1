using Microsoft.Data.Sqlite;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()));

var app = builder.Build();

app.UseCors();
app.UseDefaultFiles();
app.UseStaticFiles();

Db.Init();

// ─── API ────────────────────────────────────────────────────────────────────

app.MapGet("/api", () => Results.Ok(new { message = "API çalışıyor" }));

app.MapPost("/api/auth/register", (RegisterRequest req) =>
{
    if (string.IsNullOrEmpty(req.Email) || string.IsNullOrEmpty(req.Password))
        return Results.BadRequest(new { detail = "E-posta ve şifre zorunludur." });

    var email = req.Email.Trim().ToLower();

    var initials = req.Initials ?? "";
    if (string.IsNullOrEmpty(initials) && !string.IsNullOrEmpty(req.Name))
    {
        initials = string.Concat(
            req.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries)
                    .Select(w => w[0])).ToUpper();
        if (initials.Length > 2) initials = initials[..2];
    }
    if (string.IsNullOrEmpty(initials)) initials = "?";

    using var conn = Db.Open();

    using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = "SELECT id FROM users WHERE email = $e";
        cmd.Parameters.AddWithValue("$e", email);
        if (cmd.ExecuteScalar() != null)
            return Results.BadRequest(new { detail = "Bu e-posta zaten kayıtlı." });
    }

    long id;
    using (var cmd = conn.CreateCommand())
    {
        cmd.CommandText = @"
            INSERT INTO users (name, email, password, role, role_label, institution, city, initials)
            VALUES ($name, $email, $pw, $role, $rl, $inst, $city, $ini)
            RETURNING id";
        cmd.Parameters.AddWithValue("$name",  req.Name ?? "");
        cmd.Parameters.AddWithValue("$email", email);
        cmd.Parameters.AddWithValue("$pw",    req.Password);
        cmd.Parameters.AddWithValue("$role",  req.Role ?? "");
        cmd.Parameters.AddWithValue("$rl",    req.RoleLabel ?? "");
        cmd.Parameters.AddWithValue("$inst",  (object?)req.Institution ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$city",  (object?)req.City ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$ini",   initials);
        id = (long)(cmd.ExecuteScalar() ?? throw new Exception("Insert başarısız."));
    }

    var user = Db.GetUser(conn, id);
    return Results.Ok(new { access_token = $"fake-jwt-{id}", user });
});

app.MapPost("/api/auth/login", (LoginRequest req) =>
{
    var email = (req.Email ?? req.Username ?? "").Trim().ToLower();
    var password = req.Password ?? "";

    if (string.IsNullOrEmpty(email) || string.IsNullOrEmpty(password))
        return Results.BadRequest(new { detail = "E-posta ve şifre zorunludur." });

    using var conn = Db.Open();
    using var cmd = conn.CreateCommand();
    cmd.CommandText = "SELECT id FROM users WHERE email = $e AND password = $p";
    cmd.Parameters.AddWithValue("$e", email);
    cmd.Parameters.AddWithValue("$p", password);
    var result = cmd.ExecuteScalar();

    if (result == null)
        return Results.Json(new { detail = "E-posta veya şifre hatalı." }, statusCode: 401);

    var id = (long)result;
    var user = Db.GetUser(conn, id);
    return Results.Ok(new { access_token = $"fake-jwt-{id}", user });
});

app.MapGet("/", () => Results.Redirect("/areas/identity/login.html"));

app.Run("http://localhost:3000");

// ─── Models ─────────────────────────────────────────────────────────────────

record RegisterRequest(
    [property: JsonPropertyName("name")]        string? Name,
    [property: JsonPropertyName("email")]       string? Email,
    [property: JsonPropertyName("password")]    string? Password,
    [property: JsonPropertyName("role")]        string? Role,
    [property: JsonPropertyName("role_label")]  string? RoleLabel,
    [property: JsonPropertyName("institution")] string? Institution,
    [property: JsonPropertyName("city")]        string? City,
    [property: JsonPropertyName("initials")]    string? Initials
);

record LoginRequest(
    [property: JsonPropertyName("email")]    string? Email,
    [property: JsonPropertyName("username")] string? Username,
    [property: JsonPropertyName("password")] string? Password
);

// ─── Database ────────────────────────────────────────────────────────────────

static class Db
{
    private const string ConnStr = "Data Source=psycoai.db";

    public static SqliteConnection Open()
    {
        var conn = new SqliteConnection(ConnStr);
        conn.Open();
        return conn;
    }

    public static void Init()
    {
        using var conn = Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS users (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT,
                email       TEXT UNIQUE,
                password    TEXT,
                role        TEXT,
                role_label  TEXT,
                institution TEXT,
                city        TEXT,
                initials    TEXT,
                created_at  TEXT DEFAULT (datetime('now'))
            )";
        cmd.ExecuteNonQuery();
        Console.WriteLine("Tablo hazır.");
    }

    public static object GetUser(SqliteConnection conn, long id)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT * FROM users WHERE id = $id";
        cmd.Parameters.AddWithValue("$id", id);
        using var reader = cmd.ExecuteReader();
        if (!reader.Read()) throw new Exception("Kullanıcı bulunamadı.");

        string? Read(string col) =>
            reader.IsDBNull(reader.GetOrdinal(col)) ? null : reader.GetString(reader.GetOrdinal(col));

        return new
        {
            id          = reader.GetInt64(reader.GetOrdinal("id")),
            name        = Read("name"),
            email       = Read("email")!,
            role        = Read("role"),
            roleLabel   = Read("role_label"),
            institution = Read("institution"),
            city        = Read("city"),
            initials    = Read("initials"),
            created_at  = Read("created_at")
        };
    }
}
