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

    public List<ProgressionPointDto> getProgression(int campaignId) {
        List<ProgressionPointDto> body = restClient.get()
                .uri("/api/ramsey/campaigns/{id}/progression", campaignId)
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

    /** A graph's metadata by id. The response carries its bitstring; {@link GraphDto} drops it. */
    public GraphDto getGraph(int graphId) {
        return restClient.get()
                .uri("/api/ramsey/graphs/{id}", graphId)
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
