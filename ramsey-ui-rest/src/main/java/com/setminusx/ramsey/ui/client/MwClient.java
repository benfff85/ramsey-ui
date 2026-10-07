package com.setminusx.ramsey.ui.client;

import com.setminusx.ramsey.ui.config.RamseyProperties;
import com.setminusx.ramsey.ui.model.CampaignDto;
import com.setminusx.ramsey.ui.model.GraphDto;
import com.setminusx.ramsey.ui.model.StageDto;
import com.setminusx.ramsey.ui.model.FleetDto;
import com.setminusx.ramsey.ui.model.ProgressionPointDto;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.List;

@Component
public class MwClient {

    private final RestClient restClient;

    public MwClient(RestClient.Builder builder, RamseyProperties props) {
        this.restClient = builder.baseUrl(props.apiBaseUrl()).build();
    }

    public List<CampaignDto> getCampaigns() {
        List<CampaignDto> body = restClient.get()
                .uri("/api/ramsey/campaigns")
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }

    /**
     * Up to {@code limit} progression points after {@code sinceStageId}, in stage order; a page
     * shorter than {@code limit} is the last.
     *
     * Never ask for the whole series (the endpoint without parameters): it is unbounded, and at
     * 3.66M stages and 555 MB it ran this service out of heap.
     */
    public List<ProgressionPointDto> getProgressionPage(int campaignId, int sinceStageId, int limit) {
        List<ProgressionPointDto> body = restClient.get()
                .uri(uri -> uri.path("/api/ramsey/campaigns/{id}/progression")
                        .queryParam("sinceStageId", sinceStageId)
                        .queryParam("limit", limit)
                        .build(campaignId))
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }

    /**
     * A campaign's ACTIVE stage, straight from the stage table.
     *
     * The obvious-looking alternative — scan the progression for the point marked ACTIVE — costs
     * the WHOLE series (21 MB and 143,000 points, growing with every stage advance) to extract one
     * stage id. This is a couple of hundred bytes and is indexed on (campaign_id, status).
     */
    public List<StageDto> getActiveStages(int campaignId) {
        List<StageDto> body = restClient.get()
                .uri(uri -> uri.path("/api/ramsey/stages")
                        .queryParam("campaignId", campaignId)
                        .queryParam("status", "ACTIVE")
                        .build())
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }

    /**
     * A graph's metadata by id, as stored. {@code reconstruct=none} stops the middleware rebuilding
     * the bitstring of a delta-lineage graph (a replay of up to 1,000 parent hops) that
     * {@link GraphDto} would drop anyway.
     */
    public GraphDto getGraph(int graphId) {
        return restClient.get()
                .uri(uri -> uri.path("/api/ramsey/graphs/{id}")
                        .queryParam("reconstruct", "none")
                        .build(graphId))
                .retrieve()
                .body(GraphDto.class);
    }

    public List<FleetDto> getFleets() {
        List<FleetDto> body = restClient.get()
                .uri("/api/ramsey/fleets")
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        return body != null ? body : List.of();
    }
}
