// cw-extract — reads GTA V game files with CodeWalker.Core (pinned by ../fetch-codewalker.sh) and writes
// resumable, file-backed results for the package builder. It never writes into the game directory.
//
// Commands (all paths absolute or relative to the working directory):
//   keys     --game <dir> [--gen9] --work <dir>        derive the AES key from gta5.exe (stays in <work>, private)
//   scan     --game <dir> --work <dir>                 inventory of every RPF (headers only, nested archives too)
//   index    --game <dir> --work <dir>                 compact YMAP (extents, parent, flags) + YTYP archetype index
//   extract  --game <dir> --work <dir> --names a.ymap,b.ytyp,c.ydr | --list names.txt
//                                                      extract files by name (priority: update > dlc patch > dlc > base),
//                                                      write the original bytes to work/raw and CodeWalker XML to work/xml
//   region   --game <dir> --work <dir> --bbox x0,y0,x1,y1 [--max 40]
//                                                      ymaps whose entity extents intersect the box (GTA X/Y), plus
//                                                      their parents, archetypes' YTYP and drawables → extract list
//   xml-check --in <file.ymap.xml|.ytyp.xml|.ynd.xml> [--out canonical.xml]
//                                                      CodeWalker round-trip of a CodeWalker-format XML (fixtures/CI)
//
// Every long command records progress in <work>/state/*.json and skips what is already done.
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Xml;
using CodeWalker.GameFiles;

static class Program
{
    static readonly JsonSerializerOptions J = new() { WriteIndented = false };

    static int Main(string[] argv)
    {
        if (argv.Length == 0) { Console.Error.WriteLine("usage: cw-extract <keys|scan|index|extract|region|xml-check> [options]"); return 2; }
        var a = Args(argv.Skip(1).ToArray());
        try
        {
            switch (argv[0])
            {
                case "keys": return Keys(a);
                case "scan": return Scan(a);
                case "index": return Index(a);
                case "extract": return Extract(a, null);
                case "region": return Region(a);
                case "xml-check": return XmlCheck(a);
                default: Console.Error.WriteLine($"unknown command {argv[0]}"); return 2;
            }
        }
        catch (Exception e)
        {
            // one machine-readable line for the service, then the details
            Console.WriteLine(JsonSerializer.Serialize(new { error = e.GetType().Name, message = e.Message }));
            Console.Error.WriteLine(e);
            return 1;
        }
    }

    // ------------------------------------------------------------------ options / state
    static Dictionary<string, string> Args(string[] a)
    {
        var d = new Dictionary<string, string>();
        for (int i = 0; i < a.Length; i++)
            if (a[i].StartsWith("--")) d[a[i][2..]] = i + 1 < a.Length && !a[i + 1].StartsWith("--") ? a[++i] : "true";
        return d;
    }
    static string Need(Dictionary<string, string> a, string k) => a.TryGetValue(k, out var v) ? v : throw new ArgumentException($"missing --{k}");
    static string WorkDir(Dictionary<string, string> a) { var w = Path.GetFullPath(Need(a, "work")); Directory.CreateDirectory(Path.Combine(w, "state")); return w; }
    static T LoadState<T>(string work, string name) where T : new()
    {
        var p = Path.Combine(work, "state", name + ".json");
        return File.Exists(p) ? JsonSerializer.Deserialize<T>(File.ReadAllText(p)) ?? new T() : new T();
    }
    static void SaveState<T>(string work, string name, T s)
    {
        var p = Path.Combine(work, "state", name + ".json");
        File.WriteAllText(p + ".tmp", JsonSerializer.Serialize(s, new JsonSerializerOptions { WriteIndented = true }));
        File.Move(p + ".tmp", p, true); // atomic replace: an interrupted run never leaves a torn state file
    }
    static void Progress(string step, object info) => Console.WriteLine(JsonSerializer.Serialize(new { step, info }, J));

    // ------------------------------------------------------------------ keys
    /// CodeWalker's GTA5Keys.LoadFromPath builds Windows paths ("\\gta5.exe"); on Linux we derive the AES key
    /// with GenerateV2 from the executable bytes and hand it to LoadFromPath as a key string instead.
    static void InitKeys(string game, bool gen9, string work)
    {
        var keyFile = Path.Combine(work, "state", gen9 ? "aes-gen9.key" : "aes.key");
        if (!File.Exists(keyFile))
        {
            var exe = Path.Combine(game, gen9 ? "gta5_enhanced.exe" : "GTA5.exe");
            if (!File.Exists(exe)) exe = Path.Combine(game, gen9 ? "GTA5_Enhanced.exe" : "gta5.exe");
            if (!File.Exists(exe)) throw new FileNotFoundException($"game executable not found in {game} (needed to derive the archive keys)", exe);
            GTA5Keys.GenerateV2(File.ReadAllBytes(exe), s => Progress("keys", s));
            if (GTA5Keys.PC_AES_KEY == null) throw new InvalidOperationException("AES key not found in the executable");
            File.WriteAllText(keyFile, Convert.ToBase64String(GTA5Keys.PC_AES_KEY));
        }
        GTA5Keys.LoadFromPath(game, gen9, File.ReadAllText(keyFile).Trim());
    }
    static int Keys(Dictionary<string, string> a)
    {
        var work = WorkDir(a);
        InitKeys(Path.GetFullPath(Need(a, "game")), a.ContainsKey("gen9"), work);
        Progress("keys", "ready");
        return 0;
    }

    // ------------------------------------------------------------------ scan
    class ScanState { public List<string> Done { get; set; } = new(); public List<string> Failed { get; set; } = new(); }
    record InvEntry(string rpf, string path, string name, string ext, long size, bool resource, int version, bool encrypted, int priority);

    /// content priority: later layers override earlier ones (base < dlc < dlc patch < update)
    static int Priority(string rel)
    {
        var r = rel.Replace('\\', '/').ToLowerInvariant();
        if (r.StartsWith("update/")) return r.Contains("/dlc_patch/") ? 40 : 50;
        if (r.Contains("dlcpacks/")) return r.Contains("patch") ? 30 : 20;
        return 10;
    }

    static IEnumerable<string> RootRpfs(string game) =>
        Directory.EnumerateFiles(game, "*.rpf", SearchOption.AllDirectories)
            .Where(p => !p.Contains($"{Path.DirectorySeparatorChar}mods{Path.DirectorySeparatorChar}")).OrderBy(p => p);

    static IEnumerable<RpfFile> WithChildren(RpfFile f) { yield return f; foreach (var c in f.Children ?? new()) foreach (var x in WithChildren(c)) yield return x; }

    static int Scan(Dictionary<string, string> a)
    {
        var game = Path.GetFullPath(Need(a, "game")); var work = WorkDir(a);
        InitKeys(game, a.ContainsKey("gen9"), work);
        var st = LoadState<ScanState>(work, "scan");
        var inv = Path.Combine(work, "inventory"); Directory.CreateDirectory(inv);
        var all = RootRpfs(game).ToList();
        int n = 0;
        foreach (var full in all)
        {
            var rel = Path.GetRelativePath(game, full).Replace('\\', '/');
            n++;
            if (st.Done.Contains(rel)) continue;
            var outFile = Path.Combine(inv, rel.Replace('/', '_') + ".jsonl");
            try
            {
                var rpf = new RpfFile(full, rel);
                rpf.ScanStructure(null, err => Console.Error.WriteLine($"[scan] {rel}: {err}"));
                using var w = new StreamWriter(outFile + ".tmp", false, Encoding.UTF8);
                foreach (var f in WithChildren(rpf))
                    foreach (var e in f.AllEntries ?? new())
                        if (e is RpfFileEntry fe)
                        {
                            var ext = Path.GetExtension(fe.Name).ToLowerInvariant();
                            var res = fe as RpfResourceFileEntry;
                            w.WriteLine(JsonSerializer.Serialize(new InvEntry(rel, fe.Path, fe.Name, ext, fe.FileSize, res != null, res?.Version ?? 0, fe.IsEncrypted, Priority(fe.Path)), J));
                        }
                w.Close();
                File.Move(outFile + ".tmp", outFile, true);
                st.Done.Add(rel);
            }
            catch (Exception e) { st.Failed.Add($"{rel}: {e.Message}"); }
            SaveState(work, "scan", st);
            Progress("scan", new { done = st.Done.Count, total = all.Count, rpf = rel });
        }
        Progress("scan", new { complete = true, done = st.Done.Count, failed = st.Failed.Count });
        return st.Failed.Count == 0 ? 0 : 3;
    }

    static IEnumerable<InvEntry> Inventory(string work) =>
        Directory.EnumerateFiles(Path.Combine(work, "inventory"), "*.jsonl")
            .SelectMany(File.ReadLines).Select(l => JsonSerializer.Deserialize<InvEntry>(l)!);

    /// the winning entry per file name (highest content priority), with overridden alternatives kept for provenance
    static Dictionary<string, List<InvEntry>> ByName(string work, Func<InvEntry, bool> filter)
    {
        var d = new Dictionary<string, List<InvEntry>>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in Inventory(work).Where(filter)) { if (!d.TryGetValue(e.name, out var l)) d[e.name] = l = new(); l.Add(e); }
        foreach (var l in d.Values) l.Sort((x, y) => y.priority.CompareTo(x.priority));
        return d;
    }

    // ------------------------------------------------------------------ archive access (one RPF open at a time)
    static readonly Dictionary<string, RpfFile> OpenRoots = new();
    static RpfFileEntry Locate(string game, InvEntry e)
    {
        if (!OpenRoots.TryGetValue(e.rpf, out var root))
        {
            if (OpenRoots.Count > 8) OpenRoots.Clear(); // bounded: archives are re-scanned on demand (headers only)
            root = new RpfFile(Path.Combine(game, e.rpf), e.rpf);
            root.ScanStructure(null, err => Console.Error.WriteLine($"[open] {e.rpf}: {err}"));
            OpenRoots[e.rpf] = root;
        }
        foreach (var f in WithChildren(root))
            foreach (var x in f.AllEntries ?? new())
                if (x is RpfFileEntry fe && fe.Path.Equals(e.path, StringComparison.OrdinalIgnoreCase)) return fe;
        throw new FileNotFoundException($"{e.path} not found in {e.rpf}");
    }

    // ------------------------------------------------------------------ index
    class IndexState { public List<string> Ymaps { get; set; } = new(); public List<string> Ytyps { get; set; } = new(); }
    static int Index(Dictionary<string, string> a)
    {
        var game = Path.GetFullPath(Need(a, "game")); var work = WorkDir(a);
        InitKeys(game, a.ContainsKey("gen9"), work);
        var st = LoadState<IndexState>(work, "index");
        var idx = Path.Combine(work, "index"); Directory.CreateDirectory(idx);
        var ymaps = ByName(work, e => e.ext == ".ymap"); var ytyps = ByName(work, e => e.ext == ".ytyp");
        using (var w = new StreamWriter(Path.Combine(idx, "ymaps.jsonl"), true, Encoding.UTF8))
        {
            int i = 0;
            foreach (var (name, list) in ymaps)
            {
                i++; if (st.Ymaps.Contains(name)) continue;
                var e = list[0];
                try
                {
                    var fe = Locate(game, e);
                    var y = RpfFile.GetFile<YmapFile>(fe, fe.File.ExtractFile(fe));
                    var m = y._CMapData;
                    w.WriteLine(JsonSerializer.Serialize(new
                    {
                        name, e.rpf, e.path, e.priority, overridden = list.Skip(1).Select(x => $"{x.rpf}:{x.path}"),
                        parent = m.parent.ToString(), flags = m.flags, contentFlags = m.contentFlags,
                        min = new[] { m.entitiesExtentsMin.X, m.entitiesExtentsMin.Y, m.entitiesExtentsMin.Z },
                        max = new[] { m.entitiesExtentsMax.X, m.entitiesExtentsMax.Y, m.entitiesExtentsMax.Z },
                        entities = y.AllEntities?.Length ?? 0,
                    }, J));
                }
                catch (Exception ex) { Console.Error.WriteLine($"[index] {name}: {ex.Message}"); }
                st.Ymaps.Add(name);
                if (i % 200 == 0) { w.Flush(); SaveState(work, "index", st); Progress("index-ymap", new { i, total = ymaps.Count }); }
            }
        }
        SaveState(work, "index", st);
        using (var w = new StreamWriter(Path.Combine(idx, "archetypes.jsonl"), true, Encoding.UTF8))
        {
            int i = 0;
            foreach (var (name, list) in ytyps)
            {
                i++; if (st.Ytyps.Contains(name)) continue;
                try
                {
                    var fe = Locate(game, list[0]);
                    var t = RpfFile.GetFile<YtypFile>(fe, fe.File.ExtractFile(fe));
                    foreach (var ar in t.AllArchetypes ?? Array.Empty<Archetype>())
                        w.WriteLine(JsonSerializer.Serialize(new
                        {
                            name = ar.Name, ytyp = name, list[0].rpf, list[0].priority,
                            drawableDict = ar.DrawableDict.ToString(), textureDict = ar.TextureDict.ToString(), clipDict = ar.ClipDict.ToString(),
                            assetType = ar._BaseArchetypeDef.assetType.ToString(), assetName = ar._BaseArchetypeDef.assetName.ToString(),
                            mlo = ar is MloArchetype mlo ? new { rooms = mlo.rooms?.Length ?? 0, portals = mlo.portals?.Length ?? 0, entitySets = mlo.entitySets?.Length ?? 0 } : null,
                            min = new[] { ar.BBMin.X, ar.BBMin.Y, ar.BBMin.Z }, max = new[] { ar.BBMax.X, ar.BBMax.Y, ar.BBMax.Z }, lodDist = ar.LodDist,
                        }, J));
                }
                catch (Exception ex) { Console.Error.WriteLine($"[index] {name}: {ex.Message}"); }
                st.Ytyps.Add(name);
                if (i % 100 == 0) { w.Flush(); SaveState(work, "index", st); Progress("index-ytyp", new { i, total = ytyps.Count }); }
            }
        }
        SaveState(work, "index", st);
        Progress("index", new { complete = true, ymaps = st.Ymaps.Count, ytyps = st.Ytyps.Count });
        return 0;
    }

    // ------------------------------------------------------------------ extract
    class ExtractState { public List<string> Done { get; set; } = new(); public List<string> Missing { get; set; } = new(); public List<string> Failed { get; set; } = new(); }
    static int Extract(Dictionary<string, string> a, List<string> names)
    {
        var game = Path.GetFullPath(Need(a, "game")); var work = WorkDir(a);
        InitKeys(game, a.ContainsKey("gen9"), work);
        names ??= a.TryGetValue("names", out var n) ? n.Split(',', StringSplitOptions.RemoveEmptyEntries).ToList()
            : File.ReadAllLines(Need(a, "list")).Where(l => l.Trim().Length > 0).ToList();
        var st = LoadState<ExtractState>(work, "extract");
        var wanted = new HashSet<string>(names.Select(x => x.Trim()), StringComparer.OrdinalIgnoreCase);
        var by = ByName(work, e => wanted.Contains(e.name));
        string raw = Path.Combine(work, "raw"), xml = Path.Combine(work, "xml");
        int i = 0;
        foreach (var name in wanted)
        {
            i++;
            if (st.Done.Contains(name, StringComparer.OrdinalIgnoreCase)) continue;
            if (!by.TryGetValue(name, out var list)) { if (!st.Missing.Contains(name)) st.Missing.Add(name); continue; }
            var e = list[0];
            try
            {
                var fe = Locate(game, e);
                var data = fe.File.ExtractFile(fe);
                if (data == null) throw new InvalidDataException("empty extraction");
                // originals and derived XML live apart; neither is ever written next to the game files
                var rawPath = Path.Combine(raw, e.ext.TrimStart('.'), name); Directory.CreateDirectory(Path.GetDirectoryName(rawPath)!);
                File.WriteAllBytes(rawPath, data);
                var outDir = Path.Combine(xml, e.ext.TrimStart('.')); Directory.CreateDirectory(outDir);
                var text = MetaXml.GetXml(fe, data, out var fn, outDir); // ydr/ytd/yft also write their textures (.dds) next to it
                if (!string.IsNullOrEmpty(text)) File.WriteAllText(Path.Combine(outDir, fn), text);
                // source identity: the hash of the extracted original keys every later conversion (cache by source, not by name)
                var sha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(data)).ToLowerInvariant();
                File.WriteAllText(Path.Combine(outDir, name + ".source.json"), JsonSerializer.Serialize(new { name, sha256, bytes = data.Length, e.rpf, e.path, e.priority, e.version, overridden = list.Skip(1).Select(x => $"{x.rpf}:{x.path}") }, J));
                st.Done.Add(name);
            }
            catch (Exception ex) { st.Failed.Add($"{name}: {ex.Message}"); }
            if (i % 20 == 0) SaveState(work, "extract", st);
            Progress("extract", new { i, total = wanted.Count, name });
        }
        SaveState(work, "extract", st);
        Progress("extract", new { complete = true, done = st.Done.Count, missing = st.Missing, failed = st.Failed });
        return st.Failed.Count == 0 ? 0 : 3;
    }

    // ------------------------------------------------------------------ region selection
    static int Region(Dictionary<string, string> a)
    {
        var work = WorkDir(a);
        var b = Need(a, "bbox").Split(',').Select(s => float.Parse(s, System.Globalization.CultureInfo.InvariantCulture)).ToArray();
        int max = a.TryGetValue("max", out var m) ? int.Parse(m) : 40;
        var ymaps = File.ReadLines(Path.Combine(work, "index", "ymaps.jsonl")).Select(l => JsonDocument.Parse(l).RootElement).ToList();
        var byName = ymaps.ToDictionary(y => y.GetProperty("name").GetString()!, StringComparer.OrdinalIgnoreCase);
        bool Hit(JsonElement y) { var mn = y.GetProperty("min"); var mx = y.GetProperty("max"); return mn[0].GetSingle() <= b[2] && mx[0].GetSingle() >= b[0] && mn[1].GetSingle() <= b[3] && mx[1].GetSingle() >= b[1]; }
        var pick = ymaps.Where(Hit).OrderBy(y => y.GetProperty("entities").GetInt32()).Take(max).Select(y => y.GetProperty("name").GetString()!).ToList();
        // parents carry the LOD/SLOD chain of the chosen HD maps
        foreach (var p in pick.ToList())
        {
            var cur = byName[p];
            for (int guard = 0; guard < 6; guard++)
            {
                var parent = cur.GetProperty("parent").GetString();
                if (string.IsNullOrEmpty(parent) || parent == "0" || !byName.TryGetValue(parent + ".ymap", out var pe)) break;
                if (!pick.Contains(pe.GetProperty("name").GetString()!)) pick.Add(pe.GetProperty("name").GetString()!);
                cur = pe;
            }
        }
        File.WriteAllLines(Path.Combine(work, "region-ymaps.txt"), pick);
        Progress("region", new { ymaps = pick.Count, list = "region-ymaps.txt", next = "extract --list region-ymaps.txt, then pack deps (archetypes → ytyp/ydr/ytd)" });
        return 0;
    }

    // ------------------------------------------------------------------ fixtures / CI
    static int XmlCheck(Dictionary<string, string> a)
    {
        var path = Need(a, "in");
        var doc = new XmlDocument(); doc.Load(path);
        var lower = path.ToLowerInvariant();
        var sw = Stopwatch.StartNew();
        if (lower.EndsWith(".ymap.xml"))
        {
            var data = XmlMeta.GetData(doc, MetaFormat.RSC, Path.GetDirectoryName(path)!);
            var y = RpfFile.GetResourceFile<YmapFile>(data);
            var back = MetaXml.GetXml(y, out _);
            if (a.TryGetValue("out", out var o1)) File.WriteAllText(o1, back);
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, kind = "ymap", bytes = data.Length, entities = y.AllEntities?.Length ?? 0, archetypes = y.AllEntities?.Select(e => e._CEntityDef.archetypeName.ToString()).Distinct().ToArray(), parent = y._CMapData.parent.ToString(), xmlLength = back.Length, ms = sw.ElapsedMilliseconds }));
        }
        else if (lower.EndsWith(".ytyp.xml"))
        {
            var data = XmlMeta.GetData(doc, MetaFormat.RSC, Path.GetDirectoryName(path)!);
            var t = RpfFile.GetResourceFile<YtypFile>(data);
            if (a.TryGetValue("out", out var o2)) File.WriteAllText(o2, MetaXml.GetXml(t, out _));
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, kind = "ytyp", bytes = data.Length, archetypes = t.AllArchetypes?.Select(x => new { x.Name, mlo = x is MloArchetype m ? new { rooms = m.rooms?.Length ?? 0, portals = m.portals?.Length ?? 0 } : null }).ToArray(), ms = sw.ElapsedMilliseconds }));
        }
        else if (lower.EndsWith(".ynd.xml"))
        {
            var data = XmlMeta.GetYndData(doc);
            var y = new YndFile(); y.Load(data);
            if (a.TryGetValue("out", out var o3)) File.WriteAllText(o3, MetaXml.GetXml(y, out _));
            Console.WriteLine(JsonSerializer.Serialize(new { ok = true, kind = "ynd", bytes = data.Length, nodes = y.Nodes?.Length ?? 0, links = y.Links?.Length ?? 0, ms = sw.ElapsedMilliseconds }));
        }
        else throw new ArgumentException("xml-check supports .ymap.xml, .ytyp.xml and .ynd.xml");
        return 0;
    }
}
