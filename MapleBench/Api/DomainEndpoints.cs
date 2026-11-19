using MapleBench.Models;
using MapleBench.Services;

namespace MapleBench.Api;

/// <summary>
/// The NPC and String editors.
///
/// These hang off the same <c>/api</c> group as everything else, so they inherit
/// its error filter: a service that throws
/// <see cref="InvalidOperationException"/> answers with the message as written,
/// which is why every refusal in <see cref="NpcService"/> and
/// <see cref="StringEditService"/> is phrased for a person rather than a log.
/// </summary>
public static class DomainEndpoints
{
    public static void MapDomains(this RouteGroupBuilder api)
    {
        MapNpcs(api);
        MapStrings(api);
    }

    #region NPCs

    private static void MapNpcs(RouteGroupBuilder api)
    {
        // Asked before the mode is offered, so the UI can say "open Npc.wz" and
        // "open String.wz for names" rather than showing an empty grid.
        api.MapGet("/npc/capabilities", (NpcService npcs, StringPoolService strings, StringEditService editor) =>
            Results.Ok(new
            {
                available = npcs.IsAvailable,
                names = strings.HasSource,
                // Names and chat text are writable only when String.wz is open,
                // which is a different question from whether it can be read.
                canEditText = editor.IsAvailable,
            }));

        // Paged when asked, whole when not -- the same contract as /api/mob/list.
        // Omitting both parameters returns exactly the shape it always did, so an
        // existing caller is unaffected; supplying either lets a 10,742-row grid
        // paint its first screen without waiting for the whole list to serialise.
        api.MapGet("/npc/list", (string? fileId, bool? names, int? offset, int? limit,
            NpcService npcs, CancellationToken cancel) =>
        {
            if (offset is null && limit is null)
                return Results.Ok(npcs.List(fileId, names ?? true, cancel));

            (NpcListDto page, int total) = npcs.Page(
                fileId, names ?? true, offset ?? 0, limit ?? 200, cancel);
            return Results.Ok(new
            {
                npcs = page.Npcs,
                stats = page.Stats,
                truncated = page.Truncated,
                total,
                offset = offset ?? 0,
                limit = limit ?? 200,
            });
        });

        api.MapGet("/npc/detail", (string path, NpcService npcs) =>
            Results.Ok(npcs.Detail(path)));

        api.MapPost("/npc/fields", (NpcWriteRequest request, NpcService npcs) =>
            Results.Ok(npcs.WriteFields(request)));

        // dryRun defaults to true in the DTO, so a body that omits it previews
        // rather than writes. The dangerous default is the safe one.
        api.MapPost("/npc/bulk", (NpcBulkRequest request, NpcService npcs) =>
            Results.Ok(npcs.Bulk(request)));
    }

    #endregion

    #region String.wz

    private static void MapStrings(RouteGroupBuilder api)
    {
        api.MapGet("/string/capabilities", (StringEditService strings) =>
            Results.Ok(new
            {
                available = strings.IsAvailable,
                maxRows = StringEditService.MaxRows,
                kinds = StringEditService.Kinds.Select(k => new
                {
                    kind = k.Kind,
                    // 20261117pan修改：界面标签汉化。服务内部的 Label 仍用于
                    // 英文错误文案（如 "not one of Items' indexed fields"），
                    // 这里只把给前端的显示名换掉，避免破坏既有报错。
                    label = k.Kind switch
                    {
                        "item" => "物品",
                        "mob" => "怪物",
                        "skill" => "技能",
                        "npc" => "NPC",
                        "map" => "地图",
                        _ => k.Label,
                    },
                    fields = k.Fields,
                    images = k.Images.Select(i => new { image = i.Image, layout = i.Layout.ToString() }),
                }),
                // The groups a new entry can be filed under, read from the open
                // archive rather than from a table — a private server's String.wz
                // may have categories a stock client does not.
                eqpCategories = strings.EqpCategories(),
                mapRegions = strings.MapRegions(),
                // Rule 12: name the edge where the user reaches for it.
                unsupported = new[]
                {
                    // 20261117pan修改：这条说明由前端原样显示，汉化。
                    "客户端自身的界面文字（StringTable.img、ToolTipHelp.img、用户协议等）不按 ID " +
                    "索引，无法在此编辑——请在资源管理器中修改。",
                },
            }));

        api.MapGet("/string/list", (string kind, string? q, int? limit, StringEditService strings) =>
            Results.Ok(strings.List(kind, q, limit ?? 200)));

        // Answers for an id that has no entry too, with present:false — that is
        // the "my new item has no name" state, and it is a fact to report rather
        // than a 404 to swallow.
        api.MapGet("/string/entry", (string kind, int id, StringEditService strings) =>
            Results.Ok(strings.Entry(kind, id)));

        api.MapPost("/string/write", (StringWriteRequest request, StringEditService strings) =>
            Results.Ok(strings.Write(request)));

        api.MapPost("/string/bulk", (StringBulkRequest request, StringEditService strings) =>
            Results.Ok(strings.Bulk(request)));
    }

    #endregion
}
